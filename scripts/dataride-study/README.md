# Auditoría local de DataRide 2020–2025

Corrige el cruce del estudio del 6 de septiembre de 2026 mediante snapshots locales.
No realiza peticiones de red ni contiene rutas de escritura a Supabase o ejecución
de timers. Las salidas son artefactos locales y no se publican en Git.

```sh
node --test scripts/dataride-study/matching.test.mjs
node scripts/dataride-study/audit.mjs output/estudio-dataride-2020-2025-20260906 DIRECTORIO_NUEVO
node scripts/dataride-study/verify.mjs output/estudio-dataride-2020-2025-20260906 DIRECTORIO_NUEVO
```

`matching.mjs` separa edad, género, país, familia y evidencia nominal. No usa
Levenshtein ni acepta un número arbitrario de candidatos por año. Los aliases
completos de regresión proceden del encargo y del catálogo guardado. Las
similitudes parciales y las dimensiones desconocidas quedan pendientes.

`audit.mjs` reconstruye las carreras activas del snapshot original, conserva sus
hashes y genera informe, CSV, evidencia, exclusiones junior, separación U23 y
manifiesto no aplicable. Exige una salida nueva. La categoría Ncup no basta para
inferir edad o género. Los campeonatos CN requieren una prueba interna única con
todas las dimensiones explícitas para recibir apoyo. Las colisiones inversas
invalidan la unicidad. `unique_supported` expresa apoyo del snapshot, no permiso
para crear una edición. `no_candidate` no demuestra inexistencia histórica.

`verify.mjs` verifica la partición completa, la preservación de las fuentes, los
estados, las prohibiciones del manifiesto y los casos de regresión sobre los datos
reales. Guarda `validacion-integridad.json` en la salida.

La salida definitiva de esta corrección es
`output/estudio-dataride-2020-2025-corregido-20260907-final/`.
El estudio original se conserva íntegro. El directorio corregido sin sufijo
`-final` conserva una primera pasada de validación y queda sustituido por la salida
final. No se ha eliminado contenido de `output/` ni de `work/`.
