# Tipografías de la web

Ficheros WOFF2 de **Google Sans** (SIL OFL 1.1) y **Roboto** (Apache-2.0) que
`css/fonts.css` declara con `@font-face`. Sustituyen a la hoja de
`fonts.googleapis.com` que `css/tokens.css` importaba: el navegador pasa de
encadenar CSS → hoja de Google → fuentes de gstatic (tres saltos y dos orígenes
externos) a leerlas del propio dominio.

- Ambas familias son variables: un fichero por subconjunto, compartido entre
  pesos. `css/fonts.css` mantiene los pesos y rangos Unicode que servía Google
  (Google Sans 400, 500, 600 y 700; Roboto 300, 400, 500 y 700).
- Subconjuntos incluidos: `latin`, `latin-ext`, `vietnamese`, `cyrillic`,
  `cyrillic-ext`, `greek`, `greek-ext` y `symbols`. Quedan fuera las escrituras
  que no aparecen en la web (armenio, georgiano, hebreo, indias, tailandés,
  etíope, etc.) y `math` de Roboto; sus caracteres usan la fuente del sistema.
- Origen: respuesta de
  `https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;600;700&family=Roboto:wght@300;400;500;700&display=swap`
  pedida con un `User-Agent` de Chrome reciente (devuelve WOFF2 por
  subconjunto). Descarga: 2026-10-13.

## Regenerar

1. Pedir la hoja anterior con un `User-Agent` de Chrome.
2. Para cada bloque `@font-face` de los subconjuntos incluidos, descargar la URL
   `src` y guardarla como `<familia>-<subconjunto>.woff2`.
3. Reescribir `css/fonts.css` con las mismas propiedades y
   `src: url('../fonts/web/<fichero>') format('woff2')`.

Los avisos de licencia están en `THIRD-PARTY-NOTICES.md`.
