# Tipografías de la web

Web pública: **Montserrat** (texto) y **Momo Trust Display** (logotipo), ambas
SIL OFL 1.1, que `css/app.css` asigna a `--font-body`, `--font-display` y
`--font-logo`. Panel editorial: **Google Sans** (SIL OFL 1.1) y **Roboto**
(Apache-2.0), desde `css/tokens.css`. Todas son ficheros WOFF2 que
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

## Montserrat y Momo Trust Display

- Montserrat es variable (pesos 100–900, un fichero por subconjunto):
  `latin`, `latin-ext`, `vietnamese`, `cyrillic` y `cyrillic-ext`. Momo Trust
  Display tiene un solo peso (400): `latin`, `latin-ext` y `vietnamese`.
- Origen: `https://fonts.googleapis.com/css2?family=Montserrat:wght@100..900&display=swap`
  y `https://fonts.googleapis.com/css2?family=Momo+Trust+Display&display=swap`,
  con el mismo `User-Agent` de Chrome. Descarga: 2026-10-21.
- `Montserrat Fallback` (en `css/fonts.css`) es Arial con las métricas de
  Montserrat (`size-adjust`, `ascent-override`, `descent-override`): mientras
  llega la fuente el texto ocupa casi lo mismo y el cambio no desplaza la
  página. Si se cambia de familia, hay que volver a medirlas.

## Style Script

- Firma del rediseño en el pie (`.site-footer__signature`). Un peso (400),
  solo `latin`: `style-script-latin.woff2`.
- Origen: `https://fonts.googleapis.com/css2?family=Style+Script&display=swap`,
  con el mismo `User-Agent` de Chrome. Descarga: 2026-11-04.

## Regenerar

1. Pedir la hoja anterior con un `User-Agent` de Chrome.
2. Para cada bloque `@font-face` de los subconjuntos incluidos, descargar la URL
   `src` y guardarla como `<familia>-<subconjunto>.woff2`.
3. Reescribir `css/fonts.css` con las mismas propiedades y
   `src: url('../fonts/web/<fichero>') format('woff2')`.

Los avisos de licencia están en `THIRD-PARTY-NOTICES.md`.
