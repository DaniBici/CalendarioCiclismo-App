# CC-CX F1: migraciones y contrato

Aplicación por MCP en el proyecto actual el 2026-09-12. Historial local alineado con las versiones registradas por Supabase:

- [20260912082915_cc_cx_f1_schema.sql](../../supabase/migrations/20260912082915_cc_cx_f1_schema.sql): doce tablas `cx_*`, relaciones por temporada/categoría, índices, RLS y privilegios.
- [20260912082922_cc_cx_f1_highlights_push.sql](../../supabase/migrations/20260912082922_cc_cx_f1_highlights_push.sql): destino `cxRace`, suscripciones privadas CX y RPC v4.

DDL aditivo. No carga carreras, torneos, corredores ni resultados reales. No activa sincronización (`syncEnabled=false`), cron, recálculo, pestañas ni envíos. No cambia categorías ni destinos de la cola push: adaptar `send-push` antes de introducirlos en F4/F5.

## Puntos y tiempos simultáneos

La modalidad se configura en `cx_tournaments.pointsScheme.categories[category].mode`. La base exige exactamente una unidad presente por fila de `cx_tournament_standings`; la correspondencia con la modalidad JSON y el cálculo se implementan en F2/F5, no mediante un CHECK sobre otra tabla.

| Modalidad | Entrada de carrera | General | Orden del total |
| --- | --- | --- | --- |
| `points` | Puesto oficial de categoría y tabla `perRank`; ajustes `bonusPoints` auditados si habilitados | `points`, `timeSeconds=NULL` | Descendente |
| `time` (X2O) | `timeSeconds` real, ganador/forfaits y `bonusSeconds` positivo a restar | `timeSeconds`, `points=NULL` | Ascendente |

El resultado de meta puede conservar tiempo y puntos a la vez; la restricción de unidad única se aplica a la general. `PointPcR` de DataRide son puntos UCI y no alimentan ninguno de los cuatro torneos. `bonusSeconds` queda NULL por defecto; cero exige confirmación. Un resultado doblado no recibe tiempo real inventado; el forfait se calcula en la general. Reglas y fuentes: [estudio](../memory/ciclocross.md#esquemas-de-puntos-de-torneos).

Relaciones compuestas impiden cruzar temporadas de carrera/torneo y publicar resultados, inscritos, TV o vídeos para categorías ausentes. TV/vídeos con categoría NULL son globales de la carrera. Al borrar una categoría se eliminan sus filas específicas y se conservan las globales. La fecha civil se almacena como DATE y el horario conocido como TIMESTAMPTZ. F2 debe validar programa y zona IANA antes de escribir horarios; los datos desconocidos permanecen NULL.

## Privilegios

Todos los objetos creados revocan privilegios heredados de PUBLIC y declaran GRANT explícitos. Las doce tablas `cx_*` permiten SELECT a anon/authenticated/service_role y al worker. El DML del panel usa authenticated con políticas `(select private.is_admin())` separadas para INSERT/UPDATE/DELETE. No se concede TRUNCATE, REFERENCES ni TRIGGER a clientes.

`cc_results_worker` tiene DML de resultados y generales, USAGE de la secuencia BIGSERIAL, UPDATE de `resultsStatus`/`resultsImportedAt`/`winnerName` en categorías y de `syncStatus`/`lastFetchAt`/`lastFetchError`/`updatedAt` en enlaces. No puede editar agenda, horarios, identidad, reglas del torneo ni activar sync. Los imports de identidad futuros requieren ruta administrativa especializada.

Las suscripciones son excepción a la lectura pública: `push_cx_race_subscriptions` permite SELECT/DML administrativo y SELECT a service_role. Anon no tiene acceso directo; authenticated ordinario no ve filas ni las modifica; el worker no tiene acceso. Las FK eliminan seguimientos al borrar dispositivo o carrera CX.

## RPC push

`set_push_subscription_v4` mantiene los diez argumentos de v3 y añade `p_followed_cx_races text[] DEFAULT NULL`. Devuelve el mismo ID de dispositivo. NULL/argumento omitido conserva CX; [] borra CX; lista reemplaza y deduplica CX. Los argumentos de carretera mantienen el comportamiento v3 (incluido que sus arrays NULL equivalen a []). Los clientes v3 no borran CX.

La identificación sigue el contrato existente por token de dispositivo; no acepta un ID arbitrario de suscripción. No añade autenticación de usuario ni un RPC público de lectura. El token es la capacidad de gestión existente: debe mantenerse reservado. Token vacío o elementos vacíos se rechazan; carrera inexistente aborta toda la actualización, incluida la parte v3. El upsert del dispositivo bloquea la fila y serializa registros concurrentes.

Función SECURITY DEFINER con `search_path=''`, objetos cualificados y EXECUTE explícito para anon/authenticated/service_role. La llamada interna reutiliza v3, que conserva su definición previa. El guard `cc_check_request` añade únicamente `rpc/set_push_subscription_v4` a su lista existente; continúa bloqueando otras escrituras de authenticated ordinario. No llama al emisor.

## Comprobación reproducible

Ejecutar [supabase/tests/cc_cx_f1.sql](../../supabase/tests/cc_cx_f1.sql) mediante MCP. Genera fixtures aleatorias, usa roles anon/authenticated con identidad administrativa u ordinaria y finaliza con ROLLBACK. Comprueba restricciones de temporada/categoría/unidad, bonos desconocidos, cascadas, Cintillo, RLS/ACL, guard, registro anónimo, deduplicación, NULL/[]/v3 y rollback del RPC ante FK inválida. No usa tokens de usuarios ni envía notificaciones.

La conexión MCP tiene membresía del worker con `SET=false`; un intento de SET ROLE fue rechazado y la transacción se revirtió. Los privilegios por columna/secuencia y políticas worker se verifican en el catálogo. No se amplía esa membresía para probar. La ejecución efectiva bajo identidad worker queda para la puesta en marcha F5. Tras las comprobaciones no quedan carreras ni tokens de prueba; la secuencia puede avanzar por inserciones revertidas.

## Advisors

Seguridad antes/después: 40 avisos INFO preexistentes de RLS sin políticas y uno WARN de extensión en public; sin nuevas tablas CX sin RLS/políticas. Los avisos de funciones SECURITY DEFINER ejecutables pasan de 5 a 6 (anon) y de 8 a 9 (authenticated), exclusivamente por v4. La exposición es deliberada para registrar dispositivos sin cuenta, siguiendo v3; no implica lectura pública de la tabla. Revisar este contrato si cambia la autenticación push. Referencias: [linter anon](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [linter authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

Rendimiento: sin FK CX sin índice ni tablas CX sin PK. Avisos INFO de índices nuevos sin uso son esperables antes de cargar la temporada. No eliminar índices de agenda/ventanas/FK por ese aviso de arranque. Los otros avisos del proyecto quedan fuera de esta fase.
