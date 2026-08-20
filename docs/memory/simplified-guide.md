# Guía simplificada de horarios de paso

Muestra los horarios medios de paso por los puntos destacados de una jornada
(salida, pie y cima de cada puerto, sprints, puntos intermedios, sectores de
pavé/sterrato, llegada), además de la salida neutralizada y la llegada
prevista ya existentes. Inspirado en la tabla de horarios del rutómetro.

## Modelo de datos (sin DDL nueva)

Las horas manuales del rutómetro se guardan **dentro de cada item** de los
JSONB ya existentes de `race_days`, como campo opcional:

- `profileSummits[i].timeUtc` — ISO 8601 UTC, hora de paso por la **cima**.
- `profileWaypoints[i].timeUtc` — ISO 8601 UTC, hora de paso por el waypoint.

Salida (km 0) y llegada (km = `distanceKm`/`elevationProfile.distance`) usan
`neutralStartTimeUtc` / `estimatedFinishTimeUtc` — no se duplican.

No requiere migración: Swift `Codable` y kotlinx (`ignoreUnknownKeys`) ignoran
campos extra (mismo mecanismo que `startKm`). El pie del puerto **no** lleva
hora propia: se estima.

## Algoritmo `buildSimplifiedGuide` (función pura, paridad 3 plataformas)

- Web: `js/simplified-guide.js` (`buildSimplifiedGuide`, `hasSimplifiedGuide`).
- iOS: `Services/SimplifiedGuide.swift` (`SimplifiedGuide.build`, `.hasGuide`).
- Android: `util/SimplifiedGuide.kt` (`SimplifiedGuide.build`, `.hasGuide`).

Devuelve una lista `GuideRow { km, kmToGo, type, label, category, timeUtc,
isEstimated }` ordenada por km. Lógica:

1. Reúne puntos: salida; por cada summit → pie (`climb_foot`, sin hora) + cima
   (`summit`, con `timeUtc` manual si la hubiera); cada waypoint visible; llegada.
2. Visibilidad de waypoints en paridad con `js/perfil-pub.js`: en CRI/CRE
   (`itt`/`ttt`) se muestran `intermediate_split`; en el resto, los sprints;
   pavé/sterrato/localidad siempre; `kom` nunca.
3. Ordena por km, deduplica mismo km+tipo (tol. 0.05).
4. **Opt-in por jornada:** la guía (`hasSimplifiedGuide`/`hasGuide`) solo se
   muestra si el editor ha introducido **al menos una hora real del rutómetro**
   en un punto intermedio (cima/waypoint). Las horas puramente interpoladas NO
   bastan — sin ninguna hora manual, no aparece el acceso en ninguna jornada.
5. **Interpola** las horas faltantes por km entre anclas con hora conocida
   (salida/llegada + horas manuales), redondeando al minuto, marcándolas
   `isEstimated`. **En CRI/CRE NO se interpola** (cada corredor pasa en un
   momento distinto): solo se muestran las horas manuales.

Tests con **vectores compartidos** (mismos km/horas/resultados):
`js/__tests__/simplifiedGuide.test.js`, `SimplifiedGuideTests.swift`,
`SimplifiedGuideTest.kt`. Cambiar la heurística obliga a actualizar las tres.

## Render + interacción

- **Web → modal.** El bloque "Horario" de la rejilla (`js/jornada.js`) se
  vuelve pulsable cuando `hasSimplifiedGuide`. El disparador vive en la línea
  de título (chevron) para **no aumentar la altura** del bloque en la rejilla
  horizontal de escritorio; en stacked (≤480px) aparece el enlace de texto
  "Ver horarios de paso ›". CSS en `css/app.css` (`.route-grid__block--guide`,
  `.route-grid__guide-cue/link`, `.sg-overlay/.sg-modal/.sg-row/...`).
- **Apps → despliegue inline** con cierre. iOS `StageDetailView.timeSection`
  (botón + `guideExpanded`), Android `StageScreen.TimeSection` →
  `SimplifiedGuideSection` (`AnimatedVisibility`).

Cada fila: hora local (formatters existentes `formatTimeUser`/`formatTimeLocal`),
marcador circular por tipo (mismo código de color que el perfil/mini-perfil),
nombre, km restantes, y `*` si la hora es estimada (con nota al pie).

## Panel (`js/panel.js`)

`summitRowHTML`/`waypointRowHTML` tienen un input `type=time` (`.ann-time`),
inicializado desde `timeUtc` con `formatTimeHHMM`. `_saveRaceDay` añade
`timeUtc: toTimestamp(dateKey, value)` si el input tiene valor (omite la clave
si vacío, como `startKm`/`lengthKm`).
