# Nombres CJK de corredores — 4 de septiembre de 2026

La auditoría de nombres en Supabase detectó 372 filas con anotaciones chinas junto
a la grafía latina. No se detectaron nombres con kana japoneses ni hangul coreano.
Se conservaron los tokens latinos originales, sin transliteración ni elección de
una grafía alternativa.

| Tabla | Filas revisadas | Corregidas | CJK restantes |
| --- | ---: | ---: | ---: |
| riders_men | 10.062 | 29 | 0 |
| riders_women | 3.231 | 5 | 0 |
| startlist_riders | 54.987 | 14 | 0 |
| race_uci_results | 320.019 | 323 | 0 |
| start_order_entries | 5.125 | 1 | 0 |

La vista pública `startlist_riders_resolved` tampoco contiene nombres CJK.
Los campos `otherNames` y `race_uci_stages.winnerName` no tenían incidencias.
Las 14 entradas corresponden a Shanghai, Japón, Taiwán y Vietnam de 2026.

## Reparación y evidencia

Ejemplos: `志濠 Chih Hao杜 / Tu` pasa a `Chih Hao / Tu`;
`TSAI 雅羽 Ya Yu / 蔡` pasa a `Ya Yu / Tsai`.
Cuando el apellido solo contenía Han, la fuente ya incluía su forma latina
en mayúsculas al principio del campo de nombre. Las 34 claves de identidad
canónicas permanecen iguales.

La transacción releyó y bloqueó cada id, comprobó la coincidencia íntegra con el
manifiesto y respaldó la fila antes de escribir. La comparación posterior de
las 372 filas con el respaldo confirma que únicamente cambiaron los campos de
nombre previstos. No se modificaron ids, enlaces, género, nacionalidad,
nacimiento, equipos, dorsales, tiempos, puestos ni estado de verificación.

Se conserva el respaldo completo en
`private.cjk_names_repair_20260904_backup`, con acceso de lectura e inserción
para `service_role`. Los artefactos locales no versionados de
`output/repair-cjk-names-20260904/` contienen `manifest.json`, `backup.json`,
`apply.sql`, `verify.sql`, `verification.json` y `rollback.sql`.
La evidencia nominal es la propia fila auditada: la grafía latina ya estaba
presente; no se ha usado una transliteración automática.

## Prevención

Los triggers de fichas, inscritos, resultados individuales y órdenes de salida
eliminan anotaciones CJK cuando existe grafía latina suficiente. Los nombres sin
una grafía latina completa se rechazan con `23514` para revisión de la fuente.
Los apellidos vacíos solo se reconstruyen en el patrón documentado de apellido
latino en mayúsculas, anotación CJK y nombre latino. Los nombres sin CJK se
conservan literalmente, incluidos diacríticos y otros alfabetos.

La normalización se ejecuta antes del trigger de identidad, conforme al
[orden de ejecución de PostgreSQL](https://www.postgresql.org/docs/17/sql-createtrigger.html).
El resolutor sin dorsal normaliza el display recibido para conservar su
comparación exacta con el display almacenado. Las denominaciones de equipos
quedan excluidas. Se concedió ejecución de las funciones al rol
`cc_results_worker` utilizado por el VPS.

La prueba SQL reversible está en
`scripts/data-preflight/tests/cjk-rider-names.sql`: cubre grafías mixtas,
diacríticos, Han suplementario, nombres incompletos, ambos catálogos, snapshots,
resultados sin dorsal y exclusión de equipos. El conector no permite
`SET ROLE cc_results_worker`; sus permisos se comprobaron con
`has_function_privilege`, y la escritura real se probó con `service_role`.
La comprobación web pública mostró `Sheng Yi Liao`, dorsal 193, en
[Shanghai](https://calendariociclismo.app/inscritos/tour-of-shanghai-2026/).

La suite general detectó un fallo en el test local no versionado
`js/__tests__/uci-catalog.test.js:76`, relativo al inicio concurrente de
peticiones. Ese archivo y su implementación pertenecen a otro trabajo en curso
y no se modificaron en esta reparación.

## Rollback y pendiente

`rollback.sql` restaura exclusivamente los campos de nombre del respaldo.
Debe ejecutarse por Supabase MCP mediante `apply_migration`, porque suspende
temporalmente los cinco triggers de normalización dentro de la transacción y
los reactiva al terminar. Si falta una fila o su nombre ha cambiado desde la
reparación, aborta sin dejar triggers desactivados. El rollback conserva los
demás cambios posteriores y no elimina los respaldos. Es un rollback de datos;
la retirada del control de entrada requiere revertir también sus migraciones.

Se detectó `tsai-ya-yu` en ambos catálogos con el mismo nacimiento.
Las grafías se corrigieron en ambos, pero no se fusionaron ni eliminaron
fichas. La clasificación por género y sus referencias requieren una auditoría
separada.
