# Handoff — Rediseño del panel: rail lateral + drawer único

> **Para retomar en una sesión nueva.** Lee esto entero antes de tocar nada.
> Memoria asociada: `project_panel_rail_drawer_redesign`.
> ⚠️ Los números de línea son orientativos (bailan al editar). **Confirma siempre con `grep`** antes de usarlos.

## Estado al cierre (2026-06-09, 2ª sesión) — REDISEÑO EN `main` ✅

- **Rama:** `claude/catalogo-oro-dni-temporal-2026-06-07`, **ya pusheada a `main`** (varias veces; en sync). El rediseño está ENTREGADO: shell nuevo (rail + drawer-en-todo + cero modales/popups) + Items A/B/C completos + el grueso de D.
- **Árbol:** comparte rama con la otra sesión ("Equipos públicos" — migración 080 + tooltip de corredor en inscritos). Mis commits del panel y los suyos están intercalados; cada uno toca archivos distintos. Rebase limpio en cada push.
- **Empezar cada sesión:** `git fetch origin && git rebase origin/main`.
- **Hecho en esta 2ª sesión (Items A, B, C + grueso de D):**
  - **A:** editor de jornada → drawer ancho (8º editor) + agenda como lista en el área principal.
  - **B:** `#raceModal` → drawer adaptativo nivel 1/2, `#dupScanModal` → drawer ancho; `prompt()` de duplicar → `promptDialog`. **0 `modal-overlay` y 0 popups nativos.**
  - **C (el rail):** rail vertical izq fijo (clusters DIARIO/CATÁLOGO + footer usuario/tema/Health/Salir) sustituye pestañas+hamburguesa; vistas reancladas a `left:var(--rail-width)`; rail→iconos en <768px. Iconos a petición de Dani: logo=monograma "CC", Inscritos=hoja, Cintillo=lupa, Challenges=estrella.
  - **D (parcial):** `createGenderToggle` (`js/components/gender-toggle.js`, dedup roster+dup-scan); dedup del MARKUP de la toolbar WYSIWYG (`mdToolbarHtml`, comportamiento intacto); "Resultados (avanzado)" colapsable (`<details>`) en jornada; primer slice del barrido inline (`u-inline-icon`). **`createRacePicker` NO se hizo a propósito** (cintillo `hl-race-*` y push son UIs distintas → abstracción forzada).

## Qué se busca (objetivo final)

Sustituir las **6 pestañas horizontales + hamburguesa** por un **rail vertical izquierdo permanente** y llevar **TODA la edición a un drawer deslizante** a la derecha. Resultado: un solo paradigma de edición, cero modales centrados, cero popups nativos, mucho mejor en móvil.

- **Rail (Fase 2):** cluster DIARIO (Agenda · Analytics · Inscritos · Notificaciones) + cluster CATÁLOGO (Equipos · Cintillo · Carreras · Challenges). Footer: email + tema + Health + Salir. Rail colapsado a **iconos (~56px) en móvil**. Decisión de Dani: 4 pestañas arriba como mucho; Analytics es de uso diario (se queda arriba).
- **Drawer:** rail+drawer se montan a la vez. Decisión de Dani: **reescribir cada editor a render-en-drawer** (sin markup estático aparte), no node-move.
- **Barra de fecha global:** promover la date-nav de la agenda (hoy solo en Agenda) a un strip sobre el contenido, disponible en todas las secciones.

## HECHO (verificado en navegador) ✅

1. **Fase 0:** control muerto `detectColorsBtn` eliminado; capa de utilidades CSS `u-*` (al final de `css/panel.css`); tokens `--topbar-height`/`--rail-width` (sustituyen literales `52px`).
2. **Componente drawer** — `js/components/drawer.js`: `openDrawer({title, level:1|2, wide, render, onClose})`, `closeDrawer(level?)`, `isDrawerOpen()`. Host `#ccDrawerRoot` (#ccDrawer1/2) en `app.html`; CSS `.cc-drawer` en `panel.css`. **2 niveles apilables** (equipo→ficha; jornada→carrera); Esc/click-scrim cierran el nivel más alto; cerrar nivel 1 arrastra el 2; bloquea scroll de fondo. **`wide:true`** (`.cc-drawer--wide`, clamp 640/64vw/1040px) para editores densos (jornada, dup-scan).
3. **Componente diálogo** — `js/components/dialog.js`: `confirmDialog(msg, …)→Promise<bool>`, `alertDialog(msg, …)→Promise<void>`, **`promptDialog(msg, {…, placeholder, value, inputType})→Promise<string|null>`**. Diálogo centrado en desktop, **hoja inferior en móvil**, z-400 (sobre el drawer). CSS `.cc-dialog` / `.cc-dialog__input`.
4. **Cero popups nativos:** los 31 `confirm()`/`alert()` + el `prompt()` de duplicar jornada migrados (destructivos con `{danger:true}`). **0 `modal-overlay` y 0 popups nativos en todo el panel.**
5. **Los 10 editores/overlays → drawer:** carrera, nueva carrera, challenge, **inscritos** (crítico), **equipo** (el más grande), **ficha de corredor (nivel 2 apilado)**, cintillo, **jornada (8º, el más grande y distinto — agenda ahora es una lista; tap → drawer ancho)**, **selector de carrera `#raceModal` (9º, nivel 2 sobre la jornada o nivel 1 desde la agenda)**, **escáner de duplicados `#dupScanModal` (10º, drawer ancho)**.

## El patrón de conversión (validado en los 7 editores) — SÍGUELO

Por cada editor:
1. `xEditorBodyHtml()` → devuelve el form con los **MISMOS ids** que tenía el markup (solo se mueve a un template literal). Quita el botón "Cerrar" propio (el drawer trae su ✕) y el `<span>` de título (va al header del drawer). El botón **Guardar va dentro del body** (el drawer no tiene footer-slot).
2. `wireXEditor()` → **TODOS** los listeners del editor, cableados **por apertura** (no en setup).
3. `openX → openDrawer({title, level, render: body => { body.innerHTML = xEditorBodyHtml(); wireXEditor(); /* luego poblar campos por id */ }})`.
4. `closeX → closeDrawer(1)` (o `(2)` para apilado).
5. Borrar las vinculaciones estáticas del setup que tocaban ids del editor, **dejar** las de la VISTA (botón "+ nuevo", buscador de la lista, etc.).
6. Borrar el bloque de markup del editor de `app.html` (con `sed -i '' 'A,Bd'` tras confirmar fronteras).
7. Reusar helpers de `js/shared.js` (`countryFlag`, `esc`, `stageLabel`, `nameImpliesFemale`, `effectiveCountryCode`). De paso, migrar estilos inline a clases `u-*`.

## ⚠️ DOS GOTCHAS QUE ROMPEN COSAS (ambos vividos)

**GOTCHA 1 — init (peta TODO el panel):** antes de borrar el markup de un editor, busca statements `getElementById('<id>').addEventListener(...)` a **nivel de módulo (columna 0)**, fuera de cualquier función. Al quitar el markup, ese `getElementById` devuelve `null` → `.addEventListener` lanza → **aborta el init entero** (pestañas sin cablear, datos sin cargar, vistas que no cambian). **`node --check` NO lo detecta** (es runtime). Pasó con el listener `#er-uci` change.
- Chequeo: `grep -nE "^document\.getElementById\('<prefijo>" js/panel.js`
- Solución: mover ese listener a la función `wireXEditor` (per-apertura).

**GOTCHA 2 — re-wiring de paneles con guarda-once:** algunos sub-paneles se cableaban una vez con guarda booleana (`setupRosterPanel`/`_rosterReady`, `_ensureRiderEditorWired`/`_riderEditorWired`). Como el drawer **recrea el DOM en cada apertura**, esas guardas dejan los listeners muertos a partir de la 2ª apertura. Solución aplicada: cablear por apertura, con **idempotencia por instancia de DOM** (p. ej. `if (el.dataset.wired==='1') return; el.dataset.wired='1';`) si la función se llama desde >1 sitio.

## Verificación (cómo probar)

- Servidor: `node tools/static-server.mjs` (puerto **8765**). Navegar a `http://localhost:8765/panel/app.html`.
- **Dani inicia sesión manualmente** (Supabase auth) — sin sesión, redirige a `panel/index.html`. Pídeselo al empezar.
- La consola del preview MCP **a veces no captura** logs de este módulo → verifica con `getComputedStyle`/estado DOM, no solo con la consola.
- Al leer `getComputedStyle(transform)` justo tras togglear `.is-open`, esperas **~350ms** o capturas la transición a medias (la lectura da `translateX(426px)` en vez de 0).
- **Tras cada cambio:** `node --check js/panel.js` + `npm test` (38 tests) + abrir el editor afectado en el navegador. **Inscritos y jornada son misión crítica** → round-trip de campos.

## PENDIENTE (en orden sugerido)

> **Items A, B y C COMPLETADOS** en la 2ª sesión (2026-06-09). Ver "HECHO" arriba.
> - A) Editor de jornada → drawer ancho + agenda como lista. `openEditor` abre el drawer y monta `#editorArea` en su body; `renderEditor`/`saveRaceDay`/`deleteRaceDay`/`duplicateRaceDay` siguen localizándolo por id. `_ensureEditorArea()` reusa el `#editorArea` ya montado en re-renders sin abrir drawer nuevo.
> - B) `#raceModal` → drawer adaptativo (nivel 2 si hay editor de jornada abierto, nivel 1 desde la agenda; `_racePickerLevel`). `#dupScanModal` → drawer ancho nivel 1. + `promptDialog` para duplicar jornada.
> - C) **El rail** — `<nav class="panel-rail">` fijo izq (z-60), `.rail-item[data-tab]` con icono+label en clusters DIARIO/CATÁLOGO + footer (userEmail/tema/Health/Salir). `.panel-body` y las vistas se desplazan a `margin-left`/`left:var(--rail-width)`; `*View` reanclados a `top:0`. `initTabs` + el toggle activo de `switchTab` usan `.rail-item[data-tab]`. <768px → rail a iconos (`--rail-width:56px`, labels ocultos). `.panel-topbar`/`.panel-tabs`/`#panelBurgerMenu` borrados; el JS del burger queda inerte (null-guarded). **NO se hizo la "barra de fecha global"** (la date-nav sigue solo en la agenda, dentro de `.sidebar__header`) — queda como mejora opcional dentro de Item D si se quiere.

### D) Fase 3 — Declutter (HECHO el grueso; queda cola de pulido)
- ✅ `createGenderToggle()` (`js/components/gender-toggle.js`): `genderToggleHtml`/`setGenderToggleActive`/`wireGenderToggle`, usado por roster-add y dup-scan.
- ✅ Dedupe del **markup** de la toolbar WYSIWYG → `mdToolbarHtml(toolbarId, titles)`. `initMdToolbar` (comportamiento) ya estaba compartido y queda intacto.
- ✅ Disclosure "Resultados (avanzado)" colapsable en el editor de jornada (`<details class="editor-section--advanced">`; ojo: `.editor-section__body{display:flex}` pisa el colapso nativo → regla `:not([open]) > __body{display:none}`).
- ✅ `createRacePicker()` — **descartado**: cintillo (`hl-race-*` dropdown+chip, orden por startDate, name+nameEn) y push (`<select>` filtrado por año, orden UCI) son patrones distintos → unificar sería abstracción forzada.
- ✅ Barrido inline → `u-*`: **198 sustituciones en 7 lotes** (745→547). Tool: `scripts/sweep-inline-styles.mjs` (transform con merge de class, idempotente; MAP de `style="X"`→clases). Capa `u-*` ampliada (fs/color/layout atómicos componibles) + componentes `panel-view-row/label`, `u-input-*`, `u-checkbox`, `u-color-dot`, etc. **Lo que queda (547) NO es basura**: 40 `display:none` toggled por JS (intocables), 269 one-off (estilo local legítimo), y ~10 patrones repetidos que son `gap:*` suelto (dependen del padre flex) o labels casi-duplicados (3 variantes distintas de weight/spacing) → una clase compartida sería incorrecta y clases de un solo uso serían MÁS basura. Si se retoma: revisar los `gap` caso por caso.
- ⏳ (opcional) "barra de fecha global": la date-nav sigue solo en la agenda (`.sidebar__header`); promoverla a strip compartido si se quiere.

## Al terminar el rediseño completo — ESTADO
- ✅ Subido a `main` (varias veces, en sync).
- Apéndice del plan: split de `panel.js` (10k líneas) queda como PR **aparte** posterior.
