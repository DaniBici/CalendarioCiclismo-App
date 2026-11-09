# Prototipo de publicación por página

Prototipo local sobre jornadas e inscritos, ES y EN. Cada cambio publica solo las
páginas afectadas, con los renderizadores de `js/*-html.js` en Node. No toca
producción: lee la base de datos en transacciones de solo lectura y no escribe en
ella, en R2 ni en el VPS. Resultados:
`docs/informes/prototipo-publicacion-por-pagina-20261105.md`.

Dos modos de página: **isla** (jornadas), donde el navegador no vuelve a pintar, y
**híbrido** (inscritos y, en `arbol-hibrido`, también jornadas), que conserva el JS
actual y este confirma el HTML por su huella.

## Preparar el directorio de trabajo

Con `T` fuera del repositorio:

```bash
mkdir -p "$T/datos"
```

```bash
node scripts/db/sql.mjs --read-only --file tools/site/prerender-jornadas.sql > "$T/datos/jornadas.json"
```

`datos/inscritos.json` es el resultado de `leerInscritos(cliente)` de `datos.mjs`, sin
carreras: el mismo volcado que `tools/site/prerender-inscritos.sql`, sin ventana de fechas.

Solo para cotejar el `<head>` con el generador actual:

```bash
mkdir -p "$T/pages-data" "$T/plantillas"
node scripts/db/sql.mjs --read-only --file tools/site/site-data.sql > "$T/datos/site.json"
python3.12 tools/site/site_data.py --from-sql "$T/datos/site.json" "$T/pages-data"
(cd "$T/plantillas" && PAGES_DATA="$T/pages-data" SUPABASE_ANON_KEY=local python3.12 "$OLDPWD/tools/site/gen_og_pages.py" --family stages)
```

## Órdenes

```bash
node tools/publicacion/publicacion.mjs familia --trabajo "$T"
```

```bash
node tools/publicacion/publicacion.mjs head --trabajo "$T"
```

```bash
node tools/publicacion/publicacion.mjs servir --trabajo "$T" --puerto 8801
```

```bash
node tools/publicacion/publicacion.mjs vigilar --trabajo "$T" --cada 2000 --minutos 45
```

```bash
node tools/publicacion/medir.mjs --trabajo "$T" --tanda completa --repeticiones 5
```

```bash
node tools/publicacion/comprobar.mjs --trabajo "$T"
```

```bash
node tools/publicacion/ciclo.mjs --trabajo "$T"
```

- `familia`: construye los activos y publica todas las jornadas.
- `head`: coteja el `<head>` en Node con el de `gen_og_pages.py`, campo a campo.
- `servir`: sirve el árbol en HTTP/2 con certificado autofirmado. `/__simular?slug=<slug>&tipo=tv|hora|documento`
  publica un cambio en memoria y `/__restaurar?slug=<slug>` lo retira.
- `vigilar`: señal por `xmin` y publicación de los cambios reales, en `<T>/vigilancia.jsonl`.
- `medir`: web actual frente al prototipo con Chrome sin interfaz. Tandas: `humo`,
  `completa`, `peor`, `panorama`, `vivo` y `atajos`.
- `comprobar`: paridad de texto por zona e idioma y funcionamiento de lo interactivo.
- `ciclo`: altas, cambios del `<head>`, cambios de slug, bajas y traslados, con los
  datos modificados en memoria.

## Piezas

| Archivo | Función |
| --- | --- |
| `datos.mjs` | Índice de jornadas, lectura de una carrera y señal por `xmin` |
| `head.mjs` | `<head>` de jornadas e inscritos, ES y EN, sin Python |
| `trabajador.mjs` | Pintado por idioma con su zona horaria y variantes de televisión por región |
| `publicador.mjs` | Brotli, escritura atómica, altas, retiradas y redirecciones de slug |
| `construir.mjs` | Activos con hash e inserción del script previo al primer pintado |
| `servidor.mjs` | Reglas de nginx: HTTP/2, Brotli, `immutable`, `no-cache` con ETag; espejo de producción, también como respaldo de lo no publicado |
| `cliente/` | Script previo al primer pintado, isla y trozos del perfil y de los diálogos |
| `medir.mjs`, `comprobar.mjs`, `ciclo.mjs` | Medición y comprobaciones |

## Fuera del prototipo

Solo cubre jornadas e inscritos con lista. Las demás familias, los feeds y el sitemap
siguen en el build actual, y las páginas sin publicar se piden a la web actual. La
página de error es un texto mínimo. Nada se ha servido desde el VPS.
