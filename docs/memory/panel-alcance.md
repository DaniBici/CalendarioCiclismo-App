# Alcance del panel de administración

Desde el 2026-11-01 el panel (`panel/app.html`) funciona en alcance reducido
para evaluar la introducción continua de datos solo mediante agentes y las
skills `cc-*`. El código de las secciones retiradas sigue en el repositorio y
se restaura sin migraciones ni cambios de datos.

## Secciones disponibles

| Sección | Contenido en alcance reducido |
| --- | --- |
| Métricas | Sin cambios. Vista inicial cuando el hash no selecciona otra (también el logo). |
| Fichajes | Sin cambios, incluidos los editores de equipo y corredor que abre el mercado. |
| Notificaciones | Un solo formulario, sin selector de área, con los destinos de carretera y de ciclocross; el destino decide la categoría (`cxRace` o la pestaña Ciclocross, `cyclocross`; el resto, `general`). Programadas e historial reúnen ambas categorías y solo los avisos creados en el panel, sin los automáticos de manga (`cx_auto_dispatch`). |
| Resultados (vista Agenda, `#agenda`, con icono de trofeo) | Jornadas de carretera del día. El editor de jornada muestra sin barra de pestañas el contenido de Resultados (clasificaciones, enlace UCI, política de sincronización, editor de clasificación) y el botón «Ver». |

## Secciones retiradas

- Rail: Operaciones, Dorsales, Cintillo, Corredores, Equipos y Carreras (con
  Challenges).
- Área de ciclocross (selector Carretera/Ciclocross del rail y sus vistas),
  salvo las notificaciones.
- Agenda: botón «+ Añadir jornada», grupo «Por añadir» y destacados del día.
- Editor de jornada: barra de pestañas y pestañas General, TV, GPX y Docs;
  acciones Dorsales, Borrar, Duplicar, Borrador y Publicar/Actualizar; bloque
  «Distancia y fuera de control», que se guarda con la ficha.
- Enlaces profundos `?cxEdit=`, `?startlist=`, `?perfil=` y `?team=`, y los
  hash de vistas retiradas: abren Métricas. `?edit=` abre el editor de
  jornada en Resultados.

## Implementación

`js/panel/scope.js` resuelve el alcance al cargar el panel y expone
`panelScopeReduced`, `isPanelTabEnabled(tab)`, `REDUCED_RAIL_ORDER` (orden del
rail; la primera es la vista inicial), `REDUCED_EDITOR_TAB` y `AGENDA_LABEL`
(rótulo de la vista Agenda en el rail; `navigation.js` cambia también su icono
por el trofeo). Lo consultan `navigation.js` (rail, hash y `switchTab`),
`main.js` (enlaces profundos y alta de jornada), `agenda.js`,
`jornada-editor.js` y `notifications.js` (área de la vista). Las secciones retiradas no se montan o quedan con
`hidden`; sus manejadores no cambian.

## Restauración

- Para todos los navegadores: `DEFAULT_SCOPE = 'full'` en
  `js/panel/scope.js`, con el flujo habitual de rama e integración en `main`.
- En un navegador, sin despliegue: abrir `/panel/app.html?alcance=completo`.
  La elección se guarda en `localStorage` (`panel_scope`) y se revierte con
  `?alcance=reducido`.
- Retirada definitiva: eliminar `scope.js` y sus condiciones junto con los
  módulos de las secciones retiradas.
