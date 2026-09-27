# Widget «Carreras de hoy» — arquitectura técnica

Widget de iOS (WidgetKit) y Android (Glance) desde las apps 5.0.9. Muestra la
carretera y el ciclocross del día con TV, texto en directo y, al terminar, los
mismos accesos que Hoy. **Sin spoilers:** nunca muestra ganadores ni líderes.
El `kind` iOS (`TodayCyclingWidget`) y el receptor Android se conservan para no
invalidar widgets ya añadidos.

## Fuente única: RPC `widget_day`

Migraciones `20260927100703_widget_day.sql` y
`20260927102519_widget_day_no_spoilers.sql`. `SECURITY INVOKER` sobre tablas de
lectura pública; `GRANT EXECUTE` a `anon`, `authenticated` y `service_role`.

```
widget_day(p_date date, p_days int = 2, p_locale text = 'es',
           p_broadcast_groups text[] = {ALL,ES,EUROPA}, p_filter text = 'all',
           p_disciplines text[] = {road,cx}, p_race_ids text[] = null,
           p_race_day_ids text[] = null, p_cx_race_ids text[] = null,
           p_cx_filter text = 'all') → jsonb
```

- **Días:** `p_date` y los siguientes (`p_days`, máx. 3). Las apps piden hoy y
  mañana: el cambio de jornada a medianoche no depende de la red.
- **Selección y orden:** jornadas publicadas; carreras canceladas fuera. Orden
  espejo de `RaceLogic.sortByCategory` (Grandes Vueltas, miniperfil,
  `proLevel`, género, `uciRank`, salida). Ciclocross después, por clase
  (CM, CDM, CC, C1, C2, CN, NAC) y hora. Descanso y anuladas al final.
- **Filtros:** `p_filter` replica `matchesCategory` (`public.widget_road_matches`).
  `p_cx_filter` replica el filtro de la agenda CX (`all|big|pro|spain`). En
  inglés se excluye `NAC`. Si llega cualquier lista de seguidas, el alcance es
  «Seguidas» y los filtros no se aplican.
- **TV:** emisiones filtradas por `p_broadcast_groups` (grupos de
  `RegionService.allowedBroadcastGroups`). `tv.status`: `time` (hora de la
  primera emisión accesible), `confirmed`, `pending`, `none`, `unavailable_es`
  (solo si `ES` está en los grupos). Emisiones solo de otras regiones → sin
  estado.
- **Resultados:** `hasResults` con la misma regla que Hoy (`race_uci_stages`
  con `keepForWeb` y filas). `resultsLink` =
  `calendariociclismo://results/{raceId}/{etapa|final}{sufijo}`; `reviveUrl` =
  primera emisión recuperable (regla `isReviveBroadcast`). En CX, `resultsLink`
  apunta a la ficha con el ancla de la primera categoría con resultados y
  `reviveUrl` a la emisión con `showInRevive` o Sporza.
- **Texto en directo:** `liveTextUrl` (asset `live_text`).
- **Próxima cita:** `days[].next`, primera jornada posterior al día (horizonte
  de 150 días), con TV.
- Textos (etapa, tipo, nombres EN, etiquetas de categoría CX) ya resueltos
  según `p_locale`.

## Presentación (ambas plataformas)

| Estado | Condición | Columna derecha |
|---|---|---|
| Programada / en curso | sin resultados | Distintivo espejo de `TVBadge`: «Live texto» solo con texto en directo (sustituye a la TV si no la hay o acompaña a la TV mientras la carrera ha salido y la emisión no); si no, TV: hora, «Íntegra» (emisión desde la salida), «Live» (emisión empezada), «TV», «Sin confirmar», «Sin TV», «No TV España» (solo ES) |
| Esperando resultados | meta estimada pasada o `raceStatus = finished` | bandera de meta + hora |
| Terminada | `hasResults` (CX: todas las mangas) | copa → resultados nativos y TV → Revive, con la iconografía de Hoy |
| Descanso / anulada | `state` | atenuada |

Tamaños: iOS `systemSmall` (carrera destacada), `systemMedium` (hasta 3 filas o
ficha ampliada con una carrera), `systemLarge` (cabecera + 7 filas + próxima
cita), `accessoryRectangular` y `accessoryInline`. Android: `SizeMode.Exact`;
ancho < 250 dp → destacada; alto ≥ 260 dp → cabecera y próxima cita; filas según
la altura disponible.

## Configuración por instancia

- **Alcance:** `appFilter` (filtro fijado en Hoy y en la agenda CX, por
  defecto), `all`, `followed` (carreras, etapas y pruebas CX seguidas).
- **Disciplina:** `both` (defecto), `road`, `cyclocross`.
- iOS: `AppIntentConfiguration` (`TodayWidgetIntent`). Android:
  `TodayWidgetConfigureActivity` (`widgetFeatures =
  reconfigurable|configuration_optional`); estado Glance por instancia
  (`WidgetConfig.KEY_SCOPE`, `KEY_DISCIPLINE`).

## iOS

- `ios-app/Shared/WidgetShared.swift` (compilado en app y extensión): App Group
  `group.app.calendariociclismo`, clave `widget_settings_v1` con
  `WidgetSettings` (idioma, grupos de TV, filtros fijados, seguidas).
- `Services/WidgetBridge.swift` (app): sincroniza `WidgetSettings` al arrancar,
  al volver a primer plano y ante cualquier `UserDefaults.didChangeNotification`
  (con 600 ms de espera); si cambian, `reloadAllTimelines`. Elimina el payload
  heredado `Caches/widget_today_payload.json`.
- Extensión: `WidgetDataSource` consulta la RPC con `SUPABASE_URL` y
  `SUPABASE_ANON_KEY` del `Info.plist` (xcconfig del proyecto) y guarda la
  respuesta en `Caches/widget_day_{alcance}_{disciplina}.json` para servirla sin
  red.
- Timeline: entradas en cada salida, TV, meta y manga CX de las próximas 26 h y
  a medianoche. Recarga cada 20 min con carreras en curso o esperando
  resultados (o salida en < 90 min), cada 2 h en otro caso, 30 min sin red.
- Banderas: `Shared/Flags.xcassets` (catálogo compartido con la app, incluye
  las comunidades autónomas). Marca: `WidgetMark` (glifo de `HeaderLogo`, plantilla).
- Localización: textos del cuerpo según el idioma de la app
  (`WidgetText.t(es, en)`); nombre, descripción y configuración del widget en
  `CalendarioCiclismoWidget/Localizable.xcstrings` (idioma del sistema).

## Android

| Clase | Rol |
|---|---|
| `TodayCyclingWidget` | Glance. Carga los datos dentro de la composición, dependiente de la configuración y de `KEY_VERSION` (una sesión Glance viva no vuelve a ejecutar `provideGlance`). |
| `WidgetDayRepository` | RPC `widget_day` vía `SupabaseService.widgetDay`; copia en `cacheDir/widget/`, válida 15 min. |
| `WidgetPresentation` | Estados, distintivos y textos (contexto con el idioma de la app). |
| `TodayWidgetRefreshWorker` | Descarga por configuración, incrementa `KEY_VERSION` de cada instancia y programa el siguiente refresco. |
| `TodayWidgetScheduler` | Periódico de 60 min (red) + puntual en el siguiente cambio visible, medianoche o cada 20 min con carreras activas. Dos ranuras alternas para que el worker en curso no se reemplace a sí mismo. |
| `TodayWidgetConfigureActivity` | Configuración por instancia. |

`CalendarioCiclismoApp` reprograma el refresco si hay widgets y, ante cambios de
idioma, filtros fijados o seguidas, invalida la copia local y fuerza un
refresco. Iconos: Material Icons en `res/drawable/ic_widget_*` (misma
iconografía que la app). Vista previa del selector: `layout/widget_today_preview.xml`
(solo vistas admitidas por `RemoteViews`: nada de `<View>`).

## Deep links

- Jornada: `calendariociclismo://stage/{raceDayId}`
- Ficha CX: `calendariociclismo://cxRace/{id}[#categoría]`
- Resultados nativos: `calendariociclismo://results/{raceId}/{etapa|final}{A|B}`
  (`DeepLink.results` en iOS, `DeepLink.Results` en Android).
- Pestañas: `calendariociclismo://tab/today`, `tab/cyclocross`.
- Texto en directo y Revive: URL externa.

## Fase 3 (2027)

Live Activities y Live Updates: ver `docs/plans/widgets-fase-3-2027.md`.
