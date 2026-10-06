# Importación de inscritos y resultados — 2026-09-04

Informe fechado. Las reglas vigentes de importación de inscritos y resultados se trasladaron el 2026-09-28 a la [referencia de carretera](../memory/carretera.md#importación-de-inscritos); aquí se conservan la causa, la ejecución y las mediciones de esa fecha.

## Causa y alcance

La demora observada procedía principalmente de la coordinación: consultas de
esquema y catálogos repetidas, transferencia varias veces de documentos completos,
manifestación manual de cada enlace y reinicio de trabajo tras una excepción. En
Finistère se registraron 25 llamadas SQL durante 15 min 15 s; esas llamadas sumaron
28,4 s. No corresponde atribuir los 15 minutos al tiempo de consulta del servidor.

El panel añadía un problema propio: consultas por equipo y guardado mediante
borrado de todos los inscritos/equipos seguido de inserciones por lotes, en
peticiones separadas. Podía perder la lista ante un fallo entre ambos pasos.

## Listas completadas

El 2026-09-04 se completaron las 43 listas que tenían el indicador desactivado:
4470 inscritos, con seis listas de soporte de CRI conservadas ocultas. La auditoría
comprobó fichas, equipos, países y unicidad, y corrigió dos homónimos antes de
activar el conjunto: Samuel Fernández Heres (O Gran Camiño, dorsal 75) y João
Martins de 2005 (Portugal do Futuro, dorsal 81 y ocho resultados). Se utilizaron
nacimientos y dorsales oficiales de UCI DataRide, competiciones 77417 y 78998.
El respaldo `private.repair_startlist_enrichment_20260904_backup` conserva 53 filas
completas. Manifiesto y SQL local: `output/auditoria-enriquecimiento-20260904.md` y
`output/enriquecimiento-20260904/aplicar.sql`. La reversión se limita a las columnas
modificadas y exige comprobar que no haya ediciones posteriores.

## Actualización del VPS

El VPS se actualizó desde `eaf647030253` a `47fa3960c366` el 2026-09-04 mediante
avance directo del checkout e instalación desde el lockfile. El timer conserva
su programación; no se alteraron ventanas, cadencias ni unidades systemd.

## Verificación y límites de rendimiento

La medición reversible de Finistère Ladies sobre 133 inscritos y 22 equipos,
sin aportar enlaces de corredor, dio 190,6 ms en preparación y 244,0 ms en
aplicación: 434,7 ms en total. Con enlaces ya disponibles, la edición empleó
68,7 ms y 155,9 ms, respectivamente. Ambas operaciones se revirtieron y se
comprobó que no quedaran modificaciones ni trabajos de importación nuevos.
Estas son mediciones del servidor con el documento ya extraído, no del tiempo
completo de adquisición o investigación. SQL: `output/enriquecimiento-20260904/benchmark.sql`.
La mejora principal verificable es la reducción del recorrido a dos operaciones
y la eliminación de transferencias, comprobaciones y reconstrucciones repetidas.
La investigación de datos nuevos sigue dependiendo de la disponibilidad de fuentes.

Se cerró la inscripción pendiente de Anton Metternich (Sauerlandrundfahrt,
dorsal 154): la ficha de fuente externa confirmó Alemania y nacimiento el 23-04-2004.
Fuente: https://example.invalid
Se creó `metternich-anton` y se enlazaron la inscripción y sus dos resultados.
Respaldo: `private.repair_anton_metternich_20260904_backup`. La operación y su
fuente están en `output/enriquecimiento-20260904/anton-metternich.md`.
