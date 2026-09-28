# Buscador web — ARCHIVADO (2026-09-28)

La página Buscar de la web (`buscar.html`, `js/buscar.js`, `css/buscar.css`)
se retira del sitio. Ya estaba fuera del sitemap y sin acceso desde la
navegación desde el 2026-07-17; el buscador de las apps se archivó antes en
`archive/buscador-apps-2026`.

## Qué hay aquí

- `buscar.html` — página maestra ES (vivía en la raíz; generaba `en/search/`).
- `buscar.js` — lógica (vivía en `js/`). Importa `./shared.js` y `./i18n.js`:
  al restaurarla en `js/` las rutas relativas vuelven a ser válidas.
- `buscar.css` — estilos (vivía en `css/`).

## Qué se retiró además (restaurar a mano si vuelve)

- `en/search/index.html` y la entrada `("buscar.html", "en/search")` de
  `PAGES` y el mapeo `/buscar.html → /search/` de `HREF_MAP` en
  `tools/build-i18n-html.py`.
- Los mapeos ES↔EN de `js/lang-switch.js` (`/buscar.html` ↔ `/en/search/`).
- La `SearchAction` del JSON-LD de `index.html` y `en/index.html`.
- La entrada `js/buscar.js` de `knip.json`.
- Las reglas `.race-card__ph-*` de `css/app.css` (fila reducida de tarjeta
  provisional, solo la usaba Buscar).

`404.html` y `en/404.html` redirigen `/buscar.html` a `/` y `/en/search/` a
`/en/`. El App Link de Android para `/buscar.html` sigue en
`AndroidManifest.xml` y `MainActivity.kt`; no se tocó para no publicar una
versión de la app solo por esto.
