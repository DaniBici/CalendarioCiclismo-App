# Ciclocross (CX)

Referencia de reglas y datos de ciclocross: calendario UCI, duración y estados de mangas, y esquemas de puntos de torneos. El contrato de datos y el procedimiento del agente viven en las skills `cc-cx-nucleo`, `cc-cx-carreras` y `cc-cx-resultados` (`.agents/skills/`); esta nota no los sustituye.

Procedimientos que se ejecutan por separado:

- [Lectura e importación de resultados](../runbooks/cc-cx-results-pipeline.md): fetcher DataRide, PDF/manual, runtime del VPS y enlazado automático.
- [Generales](../runbooks/cc-cx-standings.md): revisión de reglamento, cálculo, cola y publicación.
- [Notificaciones](../runbooks/cc-cx-push.md): preferencias, destinos, programación automática y despliegue de `send-push`.

Historia del proyecto: [plan cerrado](../plans/cerrados/cc-ciclocross-integracion.md), [cotejos oficiales F5](../informes/cc-cx-cotejos.md) y [registros de despliegue F2–F5](../informes/cc-cx-despliegue-f2-f5.md).

## Calendario oficial UCI

Fuente: directorio de competiciones UCI (`https://uci-competition.tech.uci.ch`), API JSON pública sin sesión; cliente común en `supabase/functions/_shared/uci-competition-api.mjs`. Sustituye desde el 2026-11-11 a la web uci.org (`/api/calendar` y `data-props` de cada ficha), con el mismo resultado para 2026-27: 177 pruebas y 719 categorías. DataRide se usa exclusivamente para los resultados y sus enlaces.

### Consulta y estructura

- Listado: `https://uci-competition.tech.uci.ch/api/competitions?disciplineCode=CRO&seasonYear=2027`, en páginas de 100. `seasonYear=2027` corresponde a la temporada 2026-27; no es la temporada 472 de DataRide.
- Ficha: `https://uci-competition.tech.uci.ch/api/competitions/<uuid>`; `races[]` trae una carrera por categoría y tipo con `categoryCode`, `raceTypeCode` (`IND`, `TR` para el relevo), `classCode` y fechas.
- Identidad: `v1Code` = `D2CP` + `uciCalendarId` de uci.org. `calendarSourceUrl` sigue siendo la ficha de uci.org (`/competition-details/2027/CRO/<uciCalendarId>`), como exige `cx_import_calendar`, y el manifiesto conserva `source = 'uci_web_calendar'`.

Se importan solo las seis categorías individuales ME/WE/MU/WU/MJ/WJ. Se conservan las fechas diferentes por categoría de Europeo y Mundial. El rango de la carrera sale de los días con carrera (el relevo incluido), no de las fechas de la competición, que pueden empezar la víspera de un nacional. Nombre y sede llegan sin espacios finales; la web sin protocolo se completa con `https://` y un texto que no es una URL queda en NULL. No hay horas de salida ni zona IANA: ambas quedan NULL.

### Obtención e importación

```sh
node scripts/cx/cx-calendar-import.mjs 2026-27 /tmp/cc-cx-calendar-2026-27.json
```

El CLI consulta cuatro fichas como máximo en paralelo. Si falla una ficha, cambia la estructura, se repite una categoría en fechas incompatibles o la lista está vacía, no genera un manifiesto parcial para aplicar.

Cada temporada CX admite únicamente agosto–diciembre del año inicial y enero–febrero del siguiente. El colector rechaza una prueba con fechas fuera de esa ventana antes de generar el manifiesto; el panel aplica la misma validación. No desplazar fechas oficiales para encajarlas. Marzo–julio no se muestran ni se consultan como meses CX, tampoco desde una caché anterior. Fuera de temporada, la agenda abre agosto de la temporada siguiente; febrero es el último mes navegable.

Panel → Ciclocross → Agenda/Carreras → Importar calendario UCI → Consultar UCI o abrir el manifiesto local → revisar → Aplicar calendario. La Edge Function `cx-calendar` valida JWT y administración con la identidad del editor; solo consulta UCI. El panel aplica `cx_import_calendar` con el cliente autenticado. El agente usa esa RPC por la vía SQL de `cc-nucleo`, sin REST ni credenciales en scripts.

`cx_import_calendar` valida fuente, temporada, IDs, URLs oficiales y recuentos antes de confirmar la transacción. Identidad estable por `(seasonKey,uciCalendarId)` y UUID v4 para altas. Una prueba nueva se crea con sus categorías. En una prueba existente, reimportar no modifica fechas, clase, país, sede ni categorías (tampoco recrea las borradas): solo completa `websiteUrl` ausente y devuelve en `differences` los campos y categorías en que UCI difiere, para revisarlos a mano (migración `20260929063019`). Una prueba ausente no se borra automáticamente. Fuente y resumen quedan en la auditoría privada.

### Convención de slugs y URLs públicas

La URL pública de una prueba CX es `/ciclocross/{slug}/` (y `/en/cyclocross/{slugEn o slug}/`). El slug lleva siempre el año civil de su disputa (2026 o 2027, nunca la temporada 2026-27) y no repite la disciplina que ya indica la ruta: se eliminan `ciclocross`, `ciclocros`, `ciclocrosse`, `cyclocross`, `cyclo-cross` y `cx` como palabra (con el «de»/«del»/«of» que los precede o que queda al inicio), también en `slugEn` (`copa-de-espana-de-ciclocross-marin` → `copa-de-espana-marin`, `european-cyclo-cross-championships` → `european-championships`). Las palabras compuestas (`xaxancx`, `trek-uscx`, `velocx`) y los términos en otras lenguas (`ziklokrosa`, `radquer`) se conservan:

- Campeonatos (CN/CC/CM): fórmula de campeonatos de carretera, sin año, sin federación y sin categoría; nombre castellano en `name` («Campeonato de España», «Campeonatos de Europa», «Campeonatos Panamericanos», «Campeonato del Mundo») e inglés rellenado en `nameEn`; `slug` castellano y `slugEn` inglés, ambos con el año civil.
- Prueba de un trofeo: `{slug del trofeo}-{ciudad}-{año}`; si el trofeo repite ciudad en el mismo año, se antepone la ronda («coupe-de-france-nommay-1-2026»). Sin sede confirmada, el número de ronda sustituye a la ciudad.
- Prueba sin trofeo: `{denominación actual}-{año}`; si dos pruebas comparten denominación y año (findes C1/C2), se añade `day-1`/`day-2`.

El colector UCI genera de forma automática `{denominación}-{año civil}` para las altas (con `-2`, `-3`… si el nombre y el año se repiten) y la reimportación conserva los slugs editoriales existentes. El panel recalcula slug y slugEn al crear una prueba y mientras sus valores no se hayan editado a mano (cambios de nombre, torneo, recinto o fecha); los slugs editoriales nunca se sobrescriben solos. Tras guardar, el panel comprueba la URL canónica y, si responde 404, encola la regeneración del sitio (`admin_mark_web_pages_dirty`), igual que en jornadas de carretera. La limpieza de la temporada 2026-27 y su regla quedan auditadas en `private.cx_change_log` (operaciones `campeonatos_rebrand` y `slug_cleanup` del 2026-09-13); la retirada de la disciplina de 127 slugs, como `save_race` del 2026-09-29.

Asignar torneos en el panel y completar las salidas con programas oficiales y zonas IANA verificadas. Crear enlaces `cx_race_uci_links` solo tras verificar la correspondencia real en DataRide; el calendario no depende de esos enlaces. Las referencias de reglamento F1 permanecen pendientes de revisión de edición y no activan cálculos.

### Verificación de implementación

Pruebas de JS: calendario y lógica editorial en `js/__tests__/cx-*.test.js`.

### Pendientes de documentos 2026-27

- Nueva Zelanda («Campeonato de Nueva Zelanda»): guía técnica localizada en la página de Cycling New Zealand, todavía sin fila en `assets`; pendiente de persistir.
- Radcross Illnau: horarios cargados; su mapa es de 2024 y queda rechazado por temporada.
- Go Cross día 1 y 2: horarios cargados; mapas 2024 y guía 2025 rechazados por temporada; sin emisión confirmada para 2026.
- Levoča: sin horario ni documentos; sus propozície siguen siendo de 2025; pendiente del organizador.
- Radquer Mettmenstetten (25-10): horarios cargados; sin guía técnica ni mapa 2026 (consulta del 2026-10-21). La web solo publica el Tagesprogramm 2026, que es un horario; la Ausschreibung de 2025 y los Streckenpläne de 2018–2019 quedan rechazados por temporada.
- Superprestige Overijse (25-10): mapa cargado; sin guía técnica 2026 (consulta del 2026-10-21). La página de Superprestige solo da «Praktische info» en HTML, y De Sportvrienden Overijse solo el cartel.
- Superprestige Niel (11-11): horarios y mapa 2026 cargados desde cyclocrossniel.be (`websiteUrl`; jaarmarktcross.be es un dominio aparcado); sin guía técnica 2026 (consulta del 2026-11-01). Ni la web local ni la de Superprestige publican PDF.
- Gran Premio Guerciotti (30-10) y Trofeo Città di Firenze (01-11): sin logo, guía técnica ni mapa (consulta del 2026-10-29). Federciclismo no adjunta documentos y no hay web de edición localizada.
- Ciclocross Seseña (01-11): sin logo, guía técnica ni mapa (consulta del 2026-10-29). La prueba de RFEC solo publica el cartel.
- Campeonato de Estonia (01-11): mapa capturado del Google My Maps oficial «EMV cyclo-cross 2026 rajaskeem» enlazado como «Rajakaart» en la página de EJL; el juhend no incluye plano.
- Aardbeiencross, Merksplas (14-11): horarios de la ficha de Superprestige, iguales a los de 2025 y con texto sin actualizar en la página; confirmar. Sin guía técnica ni mapa 2026 (consulta del 2026-11-02). `websiteUrl` corregida a aardbeiencross.be; el dominio que publica UCI no existe.
- Lunca Timisului (14-11): horarios del regulamento HTML; sin guía técnica ni mapa (consulta del 2026-11-02).
- Gernelle (14-11): sin horario, documentos ni web; solo Instagram `cyclocrossucigernelle`, cuyas publicaciones y formulario de inscripción no dan horas (consulta del 2026-11-02).
- Val de Esmelle (14-11) y Concello de Viveiro (15-11): solo hora general (11:00 y 10:00); sin horario por categoría, guía técnica ni plano en la Federación Galega, en el regulamento del Superprestixio ni en las redes de la federación y de la Peña Ciclista Lar (consulta del 2026-11-02).
- Bollekescross, Hamme-Zogge (15-11): horarios y mapa cargados; guía técnica e inscritos anunciados como «binnenkort» (consulta del 2026-11-02).
- Matsubushi (15-11): sin guía técnica; horario con fecha 30-09-2026, con ME1 y WE1 interpretadas como las mangas UCI.
- VAM-berg Cross (15-11): horarios por manga de MijnKNWU (`calendar/races/118046` a `118049`); sin web, documentos ni logo (consulta del 2026-11-02). Dani descartó las imágenes localizadas: el icono de Elitewheels y el cartel de colduvam.nl no son del organizador.
- Gran Premi KH-7 (15-11): horarios de la web del organizador (ucfciclisme.com, «Horaris»); sin guía técnica. Plano «Gran Premi KH7» de la página del club (archivo de 2022): el domingo cambia el trazado respecto al Dark Cross, cuyo plano es el que la Federació Catalana adjunta a la ficha. La longitud no coincide entre fuentes: ficha 2,6 km, club 3,2 km.
- Memorial Guillermo Díaz, Torrejón de Ardoz (15-11), Artika (14-11) y Gran Premio Vbiciobike-Ceutí (14-11): altas del 2026-11-02 con solo hora general (09:00, 10:00 y 14:30). Artika y Ceutí, sin documentos: Ceutí solo publica el reglamento firmado, que Dani retiró como guía técnica el 2026-11-02, igual que el de Ciudad del Ciclismo (15-11), que conserva el mapa.

Semana del 21-22 de noviembre (altas del 2026-11-12, revisión del 2026-11-16):

- Hellenic Cyclo-Cross Prestige Race (22-11): ficha eliminada con permiso de Dani. La UCI ya no la lista y el programa v3.0 de la federación griega la deja «abierto a coorganización», sin organizador ni sede. Sin resultados, inscritos ni documentos que perder. Si la UCI la vuelve a publicar, `cx_import_calendar` la crea de nuevo.
- Ciclocross Borja Gómez Méndez, Ponteareas: fecha corregida del 29-11 al 22-11 (calendario de la Federación Galega y reglamento RFEC 299-2026). Guía técnica de 21 páginas cargada, con el horario por manga (mujeres a las 13:00; Elite/Sub23 y Junior masculinos a las 14:00, estimados); sin plano, porque la guía solo describe el circuito (2.700 m). Logo del cartel.
- Ciclocross de Gurb (21-11): alta del 2026-11-12; solo hora general (09:30), ficha de ciclisme.cat como `websiteUrl`; sin horario por categoría, documentos, cartel ni logo.
- Ciclocross Calvià (22-11): alta del 2026-11-12; plano de la ficha smartweb (sin año impreso) y logo del cartel. Horario sin cargar por conflicto entre fuentes: el reglamento da 10:30 Open A, 10:32 Open B, 11:45 Infantiles, 12:15 Alevines, 12:45 Principiantes y 13:00 Promesas; el cartel y la web del club, 10:30 Open A/B, 11:45 Alevines/Infantiles y 12:30 Promesas/Principiantes. Ninguna indica qué categorías corren en Open A y Open B.
- Besa CX Elgoibar (21-11): guía técnica cargada; el plano de la guía está rotulado «2025» y no se publica como `map`; su página 7 es un mapa de entrenamientos sin año.
- Boltaña (21-11): horario por categoría del cartel del organizador (Zona Zero, 12-11): 10:00 Máster 50-60, féminas y cadetes; 12:45 Elite/Sub23, Junior, Máster 30 y 40. Las féminas se cargaron en WE y WJ a las 10:00, como en el Jarama. Sin guía ni plano. Castejón de Sos (22-11): solo hora general (10:00); sin documentos. Los dos comparten cartel.
- Mejorada del Campo (22-11): horarios por categoría cargados (la ficha FMC no los trae; nota de EsCiclismo del 13-11); logo del cartel (556×418 px); sin guía ni plano.
- Trofeu Villa d'Alginet (22-11): el horario por grupos del reglamento FCCV es idéntico al de Gandía (plantilla FCCV, como en Carlet), sin verificación independiente. Plano sustituido el 2026-11-16 por `map-2.jpg`: la federación publicó otro con circuitos de 3.000 y 1.400 m (el anterior, 3.100 y 1.700 m).
- Los Molinos (21-11): reparto de horarios del Jarama (el reglamento RFEC no indica sexo en «Junior» ni en «Elite, Sub 23»). Plano de Teams Bikers (`circuito-cx-los-molinos-26.jpeg`, entrada del 12-11) publicado por indicación de Dani (2026-11-16): lleva el rótulo «VI Trofeo» y la entrada dice que el trazado repite el de 2025, sin la plaza de toros; la sede difiere entre el cartel (Parque de las Cigüeñas) y el reglamento (C/ Las Dalias). Sin guía técnica.
- Vic (22-11): la guía técnica solo existe como presentación de Canva (`etbesport.my.canva.site/guia-t-cnica-copa-catalana-ciclocross-2026`) y conserva datos de 2025 (artículo 6: «23 de noviembre»); no cargada.
- Rapencross (21-11): guía técnica de 13 páginas (31 MB, publicada sin comprimir: la compresión solo ahorraba un 7 % y alteraba la página 9). be-MINE Cross (22-11): sin guía técnica. Ambas están en la veldritkalender de Sporza (Rapencross, además, en su programa) y el sincronizador ya creó sus filas de Sporza y HBO Max el 12 y 13-11; las dos son destacadas (corona).
- NoLimited Cup Šamorín y Grand Prix Šamorín (21 y 22-11): el SZC publica Juniorky a las 12:02 también el 22-11, pero la UCI solo lista ME, WE y MJ ese día; no se crea WJ. Guía y programa del 22-11 idénticos a los del 21-11.
- North Carolina Grand Prix (21 y 22-11): guía técnica 2026 de 8 páginas (la misma para los dos días, con un único programa) y un plano por día extraído de su página 6. Sin cartel.
- Kansai Biwako GP (22-11): MJ y WJ salen a las 10:30 con un minuto de diferencia y sin orden publicado; se cargan ambas a las 10:30. La lista de inscritos sale el 19-11.
- Radquer Hittnau (22-11): el plano y el programa conservan metadatos y pie de 2025 pese a estar en `uploads/2026/11`; confirmar con VC Hittnau.
- Logos: Bryksy Cross, Gunskirchen y Kansai salen de la portada de su guía (no hay cartel); Ponteareas, Calvià y Mejorada, de su cartel. Rapencross, be-MINE e Issoire heredan el del torneo. Sin logo: Gurb.
- Inscritos sin cargar (decisión de Dani del 2026-11-16: se aparcan). Rapencross publica a 48 h y be-MINE «unos días antes»; Hittnau, Gunskirchen, NoLimited y Grand Prix Šamorín y Bryksy ya tienen lista; Issoire inscribe por la plataforma de la FFC, cuyo certificado caducó.

Campeonato de Noruega (14-11, alta del 2026-11-14):

- Fuentes: Norges Cykleforbund (sykling.no, «NM Sykkelkross 14.–15. november 2026, IF Frøy»), web del organizador norwaycross.no y cronometraje EQ Timing (evento 83954 = sábado, NM; evento 83975 = domingo, Vargcross, NorgesCup 11). La invitación enlaza los dos eventos al revés. El domingo no es NM y no se ha dado de alta.
- Fuera del directorio UCI: sin `uciCalendarId`, `calendarSourceUrl` ni enlace DataRide. Clase `CN` (como Letonia), sin logo.
- Categorías: ME (M Senior Elite), WE (K Senior Elite), MJ (M Junior Elite, sale con M 15-16) y WJ (K Junior Elite). WE y WJ salen en la misma manga (`WE_WJ`). Sin MU/WU: la clase Senior Elite es 19+ y no separa Sub-23.
- Horario Europe/Oslo: WE y WJ 11:35, MJ 12:50, ME 13:50. La invitación v3 y EQ Timing coinciden; la página `rittinformasjon` de norwaycross.no indica 11:30 y 12:45. El programa de la invitación está rotulado «foreløpig».
- Documentos: la invitación v3 (23 páginas) como `technicalGuide` y su página 17 («Blå løype NM lørdag, endelig løype») como `map`.
- Sin estado de TV (`tvStatus` NULL, decisión de Dani del 2026-11-14): no se rotula «sin retransmisión» en una prueba tan remota. La consulta del mismo día no halló retransmisión en NCF, organizador ni EQ Timing.
- Inscritos sin cargar (campo de 30 en las cuatro categorías; ningún `CN` los tiene cargados). Fuente: `https://live.eqtiming.com/api/Startlist/83954/<etapa>?count=999`, con dorsal, nombre y apellido, club, ISO-3 y año de nacimiento.
- Resultados: proveedor `eqtiming` (2026-11-14, [pipeline](../runbooks/cc-cx-results-pipeline.md#eq-timing-en-el-worker)). Enlace del evento `83954` con `categoryKeys` `{"M Senior Elite":"ME","K Senior Elite":"WE","M Junior Elite":"MJ","K Junior Elite":"WJ"}` y `syncEnabled=true` desde el 2026-11-14; la recogida empieza cuando el VPS tenga el código de la unidad CX (hasta entonces, revisión en el monitor sin escritura). `eqtiming-results-fetch.mjs` sigue siendo el de carretera (estructura de etapas y puesto absoluto). El UCI ID de EQ Timing llega en 30 de 30 inscritos; 16 de los 30 tenían ficha el 2026-11-14 y las 14 restantes se crean con ID y año de nacimiento al cargar los resultados.

## Emisiones belgas

Reglas de carga en `cc-cx-carreras/references/emisiones.md` (Emisores belgas). Reparto 2026-27 según la
[veldritkalender de Sporza](https://sporza.be/nl/2026/09/29/wanneer-is-welke-cross-en-welke-wedstrijden-zijn-live-bij-sporza-dit-is-de-complete-veldritkalender-2026-2027~1790685673220/)
del 29-09-2026; Play Sports confirma Superprestige y Copa del Mundo en su
oferta 2026-27 ([Telenet](https://press.telenet.be/play-sports-presents-belgiums-most-comprehensive-sports-offering)).

| Prueba (2026-27) | Directo | Sporza |
| --- | --- | --- |
| Superprestige Overijse, Middelkerke, Niel, Merksplas, Heusden-Zolder, Gullegem | Play Sports y Pickx+ Sports | Solo resumen |
| Superprestige Ruddervoorde y Diegem | Sporza | Directo |
| X2O Badkamers Trofee Oudenaarde (Koppenbergcross) | Sporza | Directo |

Las demás pruebas belgas se consultan en la misma fuente al cargar sus
emisiones y se añaden a esta tabla.

### Emisiones automáticas

Desde el 2026-10-11 el sincronizador del VPS crea y corrige las filas de HBO Max
(`Eurosport (HBO Max)` + `TNT Sports (HBO Max)`) y de Sporza de las pruebas CX
(fuentes `hbo_max_cx` y `sporza_cx`; reglas en el
[runbook](../runbooks/broadcasts-vps.md#ciclocross-hbo_max_cx-sporza_cx)). Las
filas de Play Sports y Pickx+ Sports se cargan a mano: el calendario de Play
Sports no es legible de forma estable y el EPG de Pickx, legible sin sesión, no
está en el sincronizador. La hora de la fila Sporza es la de emisión del
esquema de livestreams (HG Cross: 13:30 mujeres, 14:45 hombres), anterior a la
salida de carrera (13:45 y 15:00).

## Duración y estados de mangas

Referencia: [UCI Parte V, versión 01.07.2026](https://assets.ctfassets.net/761l7gh5x5an/3X0PPNdbWNAhMGaZzKly8J/c1ffde19720611fa2fddae4e4601845b/5-CRO-20260701-E.pdf), art. 5.1.048, página 16. Revisar su vigencia antes de cada temporada. La duración es aproximada; las vueltas se anuncian al final de la segunda vuelta.

| Manga | Minutos |
|---|---:|
| ME | 60 |
| WE sin WJ | 50 |
| MU | 50 |
| WU separada | 45 |
| MJ | 40 |
| WJ separada | 40 |
| WE y WJ juntas | 45 |

### Datos necesarios

En `cx_race_categories`:

- `startTimeUtc`: salida verificada, convertida con la zona IANA del lugar.
- `durationFormat`: `individual` para una manga propia de la categoría; `WE_WJ` solo cuando el formato confirmado establece que corren juntas; `WITH_ELITE` solo en MU y WU cuando existen como categoría propia y corren dentro de la manga ME o WE (misma fecha y salida; la manga Elite en `individual`), con la duración de esa manga (MU 60, WU 50; migración `20261008110029`). NULL significa formato sin verificar. Una manga WE puede incluir WU y seguir siendo WE; una general WU derivada no crea una salida WU. Apps anteriores a la 5.0.15 y el panel previo leen `WITH_ELITE` como formato desconocido. Asignado a MU de Chantada (2026-10-08); WU solo cuando la manga WE está en `individual` (con WE_WJ, WU se queda en `individual`, 45 min).
- `durationRuleVersion`: `2026-07-01` para el reglamento revisado. No reutilizar otra versión sin revisar y actualizar el contrato.
- `durationMinutes` y `durationRuleSourceUrl`: columnas generadas por la BD. No escribirlas desde panel, importador o worker.

El editor ofrece formato por categoría, y previsualiza el final. Guardar mediante `cx_save_race`; su auditoría conserva los datos anteriores. Omitir las nuevas claves conserva metadatos existentes; enviar NULL explícito los elimina. El importador del calendario no asigna formatos ni salidas que UCI no publique.

No inferir una manga conjunta por horarios iguales ni por la presencia de WE y WJ. No añadir categorías que solo existan en una general de torneo. Los campos no verificados permanecen NULL.

### Estado temporal

Final estimado UTC = salida UTC + `durationMinutes` × 60 segundos. Usar minutos transcurridos, incluso al cruzar cambios de hora. La vista pública `cx_category_timing` aplica ese cálculo y `cx_temporal_state`:

| Condición | Estado |
|---|---|
| Carrera o categoría cancelada | `cancelled` |
| Salida o duración desconocidas | `unknown` |
| Reloj anterior a la salida | `scheduled` |
| Desde la salida hasta antes del final estimado | `live` |
| Desde el final estimado | `estimated_finished` |

`estimated_finished` no es una llegada real ni cambia `resultsStatus`. Resultados pendientes, provisionales y oficiales constituyen un estado separado. La presentación da prioridad a cancelación y resultados publicados; conserva la condición estimada de las transiciones calculadas.

Las pruebas multidía se evalúan por cada manga y su fecha. No finalizar la carrera al terminar una sola categoría. Una categoría con horario/formato desconocidos impide concluir que todas han alcanzado su final estimado.

### Clientes y pipeline

- Consultas de agenda: incluir los campos de duración en la relación `cx_race_categories`. Mantener la carga mensual.
- Web y panel comparten `js/cx/timing.js`. El reloj actualiza las etiquetas sin consultar de nuevo la BD ni reemplazar controles con foco.
- Apps F4: guardar estos campos en la caché mensual y de ficha. Calcular el estado con salida, minutos y reloj actuales; una caché antigua que no tenga esos datos mantiene `unknown`. No duplicar ni inferir una agrupación desde la general del torneo.
- Worker F5: leer la vista o los mismos campos por categoría. Abrir la ventana de recogida desde el final estimado y continuar si siguen pendientes los resultados. Sin duración/hora verificada, usar revisión o recogida manual; no fabricar una ventana de salida.

La vista es SECURITY INVOKER y tiene SELECT explícito para anon, authenticated, service_role y cc_results_worker. La edición mantiene las políticas RLS administrativas de las tablas. La función de duración tiene EXECUTE mínimo para la columna generada; el estado temporal es una función pura de lectura.

### Verificación

`js/__tests__/cx-timing.test.js` cubre la presentación y la evaluación conjunta de las mangas. Los horarios y resultados de prueba no se cargan en producción.

## Orden de los IRM en resultados

`cx_replace_results` ejecuta `private.order_cx_irm_results(raceId, category)` tras
insertar las filas (único camino de escritura de `cx_results`). Los clientes
ordenan por puesto y después por `sortOrder`, así que el orden solo afecta a la
cola sin puesto:

1. Clasificados: sin IRM, o `LAP` con puesto.
2. `LAP` sin puesto (vuelta perdida).
3. `DNF`/`ABD` (no terminó).
4. `DNS` (no salió).
5. Cualquier otro código.

Dentro de un grupo, los corredores del mismo `teamName` van juntos, con los
equipos por orden de primera aparición; una fila sin equipo conserva su lugar.
`(raceId, category, sortOrder)` es UNIQUE no diferible: la función mueve primero
las filas a valores negativos. Copia del orden previo a la corrección de
2026-10-17: `private.cx_results_irm_order_20261017_backup`.

## Esquemas de puntos de torneos

Consulta: 2026-09-12. Configuración de referencia: [cc-cx-points-schemes.json](../cc-cx-points-schemes.json). No se cargan torneos ni se activa cálculo en F1. La configuración identifica versión y fuentes; no certifica que los reglamentos 2025-26 permanezcan sin cambios en 2026-27. La RFEC enlaza todavía su Título V de 09-09-2025 desde la [normativa técnica vigente](https://rfec.com/index.php/es/smartweb/seccion/seccion/rfec/reglamentos-tecnicos-y-particulares).

### Copa del Mundo

[UCI, Parte V, versión 01-07-2025](https://assets.ctfassets.net/761l7gh5x5an/3X0PPNdbWNAhMGaZzKly8J/7cfe482b94626424f9967d6df5cb3f38/5-CRO-20250701-E.pdf), artículos 5.3.013 y 5.3.023. [Organizador: tabla de puntos](https://www.ucicyclocrossworldcup.com/en/regulations-en).

ME/WE/MU/MJ/WJ: puestos 1–25 → **40, 30, 25, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1**. ME/WE suman todas las rondas. MU/MJ/WJ retienen cuatro mejores resultados si hay hasta siete rondas, cinco si hay ocho. El número se refiere a rondas celebradas por categoría, no al calendario élite ni a participaciones del corredor. Sin bonificaciones.

Desempate: número de primeros puestos, segundos, etc. hasta puesto 25; después puntos de la ronda más reciente. La norma no explicita cómo contar plazas descartadas en ese desempate: cotejar con general oficial antes de activar cálculo juvenil.

WU compite dentro de WE; su líder se distingue en la general femenina. No crear manga WU ficticia ni volver a numerar puestos WE al filtrar sub-23. La configuración reserva una vista derivada por edad, pendiente de cotejo oficial. La categoría de toda la temporada usa el año siguiente al de inicio (art. 5.1.001); no la edad al día de la ronda. Fecha de nacimiento e identidad deben estar verificadas.

### Superprestige

[Reglamento del organizador, 2025-26](https://www.superprestigecyclocross.be/nl/reglement).

ME y WE: puestos 1–15 → **15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1**. Suma de las ocho rondas, sin descartes. Desempates: más salidas reales; después más victorias; después mejor puesto en la última ronda. DNS no cuenta como salida; DNF sí. Sin bonificaciones. El reglamento consultado no establece generales independientes MU/WU/MJ/WJ: no aplicar automáticamente la tabla élite a esas categorías.

### X2O: corrección de unidades y modelo

[Reglamento del organizador, 2025-26](https://x2otrofee.be/wp-content/uploads/sites/133/2025/09/Reglement-X2O-Badkamers-trofee-veldrijden-2025-2026.pdf), arts. 3–5 y 8; [Rookie Trophy](https://x2otrofee.be/trimetal-rookie-trophy/).

ME/WE/MU tienen **general por tiempo**, ascendente, sumando ocho rondas, sin descartes. Penalización de 300 segundos sobre el ganador para ausencia, abandono, retirada por 80% o llegada a más de cinco minutos. Los cinco minutos no incluyen las bonificaciones ganadas: el forfait vale 300 segundos sin descontar bonos (política `discard`, cotejada en F5 con los DNF de 2025-26; el texto 2026-27 conserva la redacción). Solo entra en la general quien termina alguna ronda dentro de cinco minutos del ganador. Desempates: mejor puesto de la serie; después puesto de la última ronda; precisión de segundos, sin centésimas.

Un sprint al final de la primera vuelta: **15/10/5 segundos** para sus tres primeros. Desde 2025-26 hay además **15/10/5 segundos** a los tres corredores con vueltas más rápidas, excluyendo el bucle de salida. No son puntos. No sumar estos valores a `bonusPoints`. No hay general WU/MJ/WJ definida en este reglamento.

Corrección incorporada por indicación de Dani durante F1: `pointsScheme.categories[category].mode="time"`, `cx_results.timeSeconds` (tiempo real de meta), `bonusSeconds` (agregado positivo a restar) y `cx_tournament_standings.timeSeconds` (tiempo total computado). Se conserva `bonusPoints` para ajustes en unidades de puntos. El cálculo permanece en F5.

#### Fuente de bonificaciones por ronda

El [portal de resultados X2O](https://x2otrofee.be/uitslagen/) y sus generales [ME](https://x2otrofee.be/klassement-elite-mannen/), [WE](https://x2otrofee.be/klassement-elite-vrouwen/) y [MU](https://x2otrofee.be/klassement-u23/) son los destinos oficiales para cotejo. El portal presenta la cabecera 2026-27 junto a enlaces antiguos; eso no demuestra publicación de datos de la nueva edición. La [ronda Koppenberg 2025](https://koppenbergcross.be/uitslagen-en-erelijst/) enlaza [meta ME](https://koppenbergcross.be/uitslagen-elite-mannen/) y las otras categorías, pero no publica un cuadro verificable de bonificaciones en las páginas inspeccionadas. DataRide tampoco las devuelve en esta ronda.

**Fuente de los seis premios por ronda: informe de cronometraje de Chronorace**, verificada en las ocho rondas 2025-26 y en el Koppenbergcross 01-11-2026; recogida en [Bonos X2O en el worker](../runbooks/cc-cx-results-pipeline.md#bonos-x2o-en-el-worker). DataRide y estas páginas no proporcionan los sprints. Un cambio entre dos generales permite detectar un agregado discrepante, pero no prueba qué corredor ganó cada premio. Si solo se dispone de esa diferencia, usar corrección manual auditada y registrar el origen. No deducir sprint ni vuelta rápida del puesto de meta.

`bonusSeconds=NULL` significa agregado desconocido; `0` significa ausencia de bono confirmada. En X2O no recomputar una ronda con agregado desconocido. DNS/ausentes sin fila necesitan el forfait desde el ganador y el conjunto de participantes de la serie; `timeSeconds=NULL` no equivale a cero ni al forfait. `timeText` conserva la fuente; un doblado no recibe un tiempo real inventado. La fórmula F1 `sum(ganador + min(gap,300) - bonusSeconds)` corresponde a la hipótesis `retain`. Motor v3 exige `review.forfaitBonusesPolicy` por edición/categoría: `discard` no descuenta el bono ante forfait y `retain` sí. El resultado conserva el bono ganado, aunque el desglose de general lo descarte. Los DNF oficiales de las ocho rondas X2O ME/MU 2025–26 cotejan `discard` (registro F5, sección 74), con todos los tiempos/celdas coincidentes; la elegibilidad/orden íntegros siguen sin coincidir. La referencia JSON F1 sigue inactiva, sin política por omisión ni autorización para 2026–27. Confirmar sanciones especiales y regla de igualdad de vueltas rápidas en el informe oficial antes del cotejo.

Presentación (desde 5.2.1, 2026-11-15): web, iOS y Android muestran una tabla «Bonificaciones» bajo la clasificación de cada categoría con solo las filas con `bonusSeconds` > 0, de mayor a menor y, a igualdad, por puesto. Los 0 confirmados y los NULL no se listan; sin ninguna fila positiva no hay tabla. El valor es el agregado de sprint y vuelta rápida (no se guarda el desglose por premio).

### Copa de España

[RFEC, Título V, actualización 09-09-2025](https://yosoyciclista.s3.amazonaws.com/documentos/smartweb/menu/123/doc_68c7c0ddc9db25_29075634_5-Pruebas-de-Ciclo-Cross--ap-CD-20250909_b_IZDA.pdf), V-J, arts. 4, 6–8 y 14–15.

Cada categoría: puestos 1–15 → **25, 20, 16, 14, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1**. El art. 4 define «Élite y Sub23» como una sola categoría por sexo, además de junior, cadete y máster; el modelo usa ME/WE (Élite–Sub23) y MJ/WJ. La RFEC publica una única general ELITE-SUB23 por sexo y deduce de ella el mejor sub-23: no hay general MU/WU propia. Todos los resultados cuentan, sin descartes. Desempate: mejor plaza en la última prueba celebrada. Participantes extranjeros pueden figurar en la general. No hay sprints puntuables de torneo en esta norma. Incumplimiento del maillot de líder: sanción de 25 puntos, que requiere entrada auditada.

Los puntos corresponden al puesto absoluto en la manga conjunta Élite–Sub23, extranjeros incluidos: la general 2025-26 lo acredita (Orts 25+25, Lauryssen noveno, Mira tercero como mejor sub-23) y el cotejo de Alcobendas (registro F5, sección 78) casa ese puesto con la manga ME/WE de DataRide sin renumerar por edad. WU puede ser líder absoluta; no se crean mangas MU/WU. La clase de la ronda C1/C2/NAC no cambia esta tabla. No confundirla con el ranking individual RFEC ni el ranking UCI.

### Edición 2026-27

Esquemas guardados el 2026-09-30 con `cx_save_tournament` en `verified`, `edition.seasonKey="2026-27"` y `review.recotejoAfterFirstRound=true`: el cotejo de cada categoría apunta a la general oficial 2025-26 cotejada en F5 y se repite con la primera general 2026-27 de cada torneo.

| Torneo | Fuente de reglas | Categorías | Decisiones de edición |
| --- | --- | --- | --- |
| Copa del Mundo UCI | [Parte V 01-07-2026](https://assets.ctfassets.net/761l7gh5x5an/3X0PPNdbWNAhMGaZzKly8J/c1ffde19720611fa2fddae4e4601845b/5-CRO-20260701-E.pdf), art. 5.3.013, y [lista de rondas](https://assets.ctfassets.net/761l7gh5x5an/6RPKCNSSFTxx8PQcWPqKei/b918c644280083ef53889e795861695d/2026-2027_UCI_Cyclo-cross_World_Cup-publication.pdf) | ME, WE, MU, MJ, WJ y WU derivada de WE | Cinco rondas juveniles: cuentan las cuatro mejores. `droppedPlacingsPolicy="all"`: la frase del desempate es idéntica en la Parte V de 21-06-2019 y en la de 2026, y el caso MU 2019-20 (sección 77) solo se reproduce contando los puestos descartados. `awardedAtLeastOnce` y `backwardsUntilDifferent`, como en los cotejos F5 |
| Superprestige | [Reglamento 2026-27](https://www.superprestigecyclocross.be/nl/reglement) (consultado el 2026-10-08) | ME, WE | El texto 2026-27 repite el baremo 15–1, la suma de las ocho rondas sin descartes y los desempates (salidas, victorias, última ronda); `edition.rulesEdition="2026-27"`. DNS/DNF no se regulan de forma explícita. Los desempates solo se aplican a la general final: la oficial intermedia comparte puesto entre empatados a puntos (`intermediateTiesPolicy="sharedRank"`, 2026-11-13). Cotejo 2026-27 tras Niel, tres rondas: ME 25 filas y WE 28 coinciden en puesto y puntos con la general oficial ([ME](https://www.superprestigecyclocross.be/nl/files/9de221ba-d08b-11f1-bd5d-0050569301fd/1794413808), [WE](https://www.superprestigecyclocross.be/nl/files/1a077c28-d07a-11f1-bd5d-0050569301fd/1794425668)) |
| X2O Badkamers Trofee | [Reglamento 2026-27](https://x2otrofee.be/wp-content/uploads/sites/133/2026/09/Regulation-X2O-Badkamers-trophy-2026-2027-ENG.pdf) (18-09-2026) | ME, WE, MU por tiempo | `forfaitBonusesPolicy="discard"`, `missingRoundBonuses="none"`. Novedad: una sola bonificación de vuelta rápida por corredor y ronda. Bonos de cada ronda desde Chronorace, recogidos por el worker según `extras.bonusPublication`: la general exige `bonusSeconds` y `bonusSourceUrl` en cada ronda |
| Copa de España | [Título V a 09-09-2025](https://yosoyciclista.s3.amazonaws.com/documentos/smartweb/menu/123/doc_68c7c0ddc9db25_29075634_5-Pruebas-de-Ciclo-Cross--ap-CD-20250909_b_IZDA.pdf) y [Disposiciones Generales a 02-06-2026](https://yosoyciclista.s3.amazonaws.com/documentos/smartweb/menu/123/doc_6ab10e66d5a054_43963131_1--Disposiciones-Generales-ap-CD-20260602_2109.pdf) | ME, WE (Élite–Sub23), MJ, WJ | Sin `rankPolicy`: puntúa el puesto de la manga conjunta. El reglamento de KH7 cita una «Normativa específica de la Copa de España 2026/2027» no publicada; revisarla si aparece. MJ añade tras el art. 8 un segundo desempate fuera del reglamento, por decisión de Dani (2026-11-02): puntos desde la última ronda hacia atrás (`latestRoundPoints`, `backwardsUntilDifferent`). Solo actúa si ningún empatado tiene plaza en la última prueba; caso de origen: Murguzur (DNF) y Alvarez (ausente) en Amurrio. WJ lo aplica desde el 2026-11-14, también por decisión de Dani: tras KH7, Arano/Sánchez Moreno y Egiguren/Oliveira/Tamayo, ausentes en la última prueba, dejaban la general en revisión. Al comparar puntos, Oliveira (1 punto en Xaxan) precede a Egiguren (1 punto en Siero), aunque Egiguren corrió Amurrio (21.ª) y Oliveira no. La página de la RFEC no sirve de cotejo de empates: su orden contradice el art. 8 en varios casos |
| Copa de Francia | [Règlement Coupe de France Cyclo-cross 2026-2027](https://structures.ffc.fr/app/uploads/sites/4/2026/09/Reglement-CPF-CX-2026-2027_20260928-Site-FFC.pdf) (FFC/DERS/20260924, art. 17) | ME, MJ (U19), MU (U23), WE (Elite y U23 mujer), WJ (U19) | Seis rondas, suma de todas, sin descartes. Baremo 45, 42, 40 y 39 bajando de 1 en 1 hasta 3 puntos en el puesto 40. Extranjeros incluidos (17.1). Desempates (17.9): participaciones, mejores puestos en todas las pruebas, también fuera de la zona de puntos (`countPlacings` con `ranksTo: "all"`), y última ronda. Verificada el 2026-11-13 con la [general oficial tras Nommay](https://www.stsport.fr/IMG/pdf/cdf_cc-m2-nommay-res.pdf) (ST Sport; el PDF de cada manga incluye la general): ME 46 filas, MU 49, MJ 49, WE 41 y WJ 33, con puestos y totales idénticos. La general solo lista a quien suma puntos (`awardedAtLeastOnce`). Los extranjeros consumen puesto y puntúan (Olivia Poole, WJ). Antes del cotejo se corrigieron en BD dos filas de la manga 1 sin ficha por nombre abreviado (Mattis Noel, MJ; Roxanne Porlier, WE) y el orden de los doblados de la manga 2 en ME (45-49) y WE (38-43): la carga del `.clax` en directo no coincidía con el PDF oficial. Las U23 de equipos UCI pudieron optar por la general Elite hasta el 6-10-2026 (art. 4.3.3); no se conoce la lista |
| Copa Aragón | [Reglamento X Copa Ciclocross de Aragón](https://yosoyciclista.s3.amazonaws.com/documentos/circuitos/1944/doc_6aba843cd851c5.41930654_REGLAMENTO%20CX%202026.pdf) (28-09-2026) | ME (Elite–Sub23 conjunta), MJ, WE, WJ | Suma de todas las pruebas sin descartes; baremo 90, 80, 75… 3 puntos (25 puestos). Verificada el 2026-10-08 con la general oficial tras Agreda y Olvega (puestos, totales y orden idénticos). El art. 19 pone primero las participaciones, pero la general oficial desempata por conteo de puestos y última prueba, y el esquema la reproduce. Pendiente de añadir el Campeonato de Aragón (fecha por determinar; `expected=8`) |
| Copa Ciclocross FCPA (Asturias) | [Reglamento FCPA 2026-27](https://yosoyciclista.s3.amazonaws.com/documentos/smartweb/noticia/63568/documentos/doc_6abf5dd15c0810_48511797_imagen_REGLAMENTO-COPA-CICLOCROSS-FCPA-26-27-1.pdf) (2-10-2026) | ME, MJ, WE, WJ | Antes «Copa ADN Asturies». Ocho pruebas (Salas y Mayador añadidas); Copa de España y Campeonato de España no puntúan. Baremo 60, 54, 49… 2 puntos (25 puestos); la última prueba (Circuito Mayador, 4-01-2027) puntúa doble (`roundMultipliers`) y exige haberla disputado para ganar (`leaderMustStart`). Desempate: victorias y última prueba. En `draft` hasta cotejar la primera general: a 2026-11-13, tras Corneyu y Cangas del Narcea, la FCPA no ha publicado general 2026-27 (sección [Ciclo-Cross 2026-2027](https://ciclismoasturiano.es/index.php/es/smartweb/seccion/seccion/asturias/CLASIFICACIONES/Ciclo-Cross-2026-2027), solo clasificaciones de prueba; la de 2025-26 se publicó en PDF «General ADN» en la sección equivalente). Escala y reglas del esquema revisadas contra el reglamento. Cangas no tuvo manga Elite femenina (WE cancelada) |
| Superprestixio (Galicia) | [Regulamento Superprestixio 26-27](https://yosoyciclista.s3.amazonaws.com/documentos/smartweb/menu/2453/doc_6ab4478a2c5985_64280300_REGULAMENTO-SUPERPRESTIXIO-DE-CICLOCROSS-26-27.pdf) (23-09-2026) | ME, MJ y WJ verificadas; WE pendiente | Once pruebas (fechas de Esmelle y Viveiro corregidas con el calendario federativo; Támega suspendida y Campionato de Galicia fuera del torneo). Baremo 150, 120, 100… 10 (25 puestos), sin descartes, mínimo de 2 rondas puntuadas (`minScoredRounds`, con las 11 celebradas), desempate por conteo de puestos y última prueba, y `awardedAtLeastOnce` (la federación lista solo a quien puntúa). La general puntúa Elite y Sub-23 por la clasificación conjunta de cada prueba (Rodríguez Novoa 1.º, Frías Bajo, Sub-23, 2.º): ME y WE se cargan con ELITE-SUB23 / FEM ELITE-SUB23 y MU/WU conservan la suya. ME, MJ y WJ cotejadas con la general tras Chantada (25 puntuables idénticos). Cotejo tras cinco pruebas (2026-11-13; Brión, cancelada, no está en el reglamento): ME 52 filas, MJ 37, WE 17 y WJ 8, mismos totales que la federación. Los empates que el reglamento no resuelve antes de la última prueba comparten puesto (`intermediateTiesPolicy="tieBreakersThenSharedRank"`): la federación los ordena sin criterio constante. En Carrera/Rodríguez Gómez, Rivas/Alonso y Pereira/Azevedo (ME), la federación contradice el conteo de puestos del reglamento; se mantiene el reglamento |
| Challenge CX CV (Comunitat Valenciana) | [Normativa de Ciclo-Cross 23-09-2026](https://yosoyciclista.s3.amazonaws.com/documentos/smartweb/menu/1480/doc_6ab4ed2c850fd6_21679830_Normativa-de-Ciclo-Cross-Version-230926.pdf) (arts. 8–15) | ME, MJ, WE, WJ (Elite–Sub23 única) | Catorce pruebas (Campeonato Autonómico de Castalla fuera del torneo). Baremo 120, 100, 90… hasta 1 punto desde el 81.º. La general evolutiva suma todas las pruebas; la final computa los mejores resultados en el 80 % de las puntuables con redondeo estándar (`byHeldRounds`: hasta 13 rondas se conservan todas; con 14, 11; si se cancela una prueba, ajustarlo). Desempate por puestos con puntos (`countPlacings` 1–200) y después de la última prueba hacia atrás (`latestRoundPoints`, `backwardsUntilDifferent`), como ordena la general oficial (Bañuls antes que Casares, WJ). `droppedPlacingsPolicy="retained"` solo actúa en la final y está sin cotejar. La general oficial solo lista a quien puntúa (`awardedAtLeastOnce`). Verificada el 2026-11-13 con la [general provisional del 09-11](https://fccv.es/index.php/es/smartweb/seccion/circuito/valenciana/26CICLOCROSSCV) (circuito `26CICLOCROSSCV`, ocho pruebas): MJ, WE y WJ idénticas tras corregir en BD Picassent WE (faltaban las Sub-23 y junior de la manga conjunta) y Potríes ME (Gerico y Morgan con los nombres intercambiados). ME difiere solo en Vilaplana: la oficial le da 0 en Aiacor, donde fue 5.º; se mantienen sus 80 puntos por decisión de Dani (error de la federación). El PDF de general del circuito (08-11) y la tabla HTML (09-11) no coinciden en varios totales; manda el HTML |
| Trek USCX | Sin reglamento publicado ([FAQ](https://uscx.us/faqs/)); escala deducida de la [general oficial de RaceResult](https://my.raceresult.com/424851/) y cotejada en las 24 mangas | ME, WE, MJ, WJ | Elite: día C1 50-42-38-34-32-30-28-26 y 25…5; día C2 40-32-28-24 y 22…3. Junior: escala C1 ambos días. Fuera de escala, 3 puntos al clasificado, 2 al DNF y 1 al DNS; empates compartidos. El motor no admite doble escala ni puntos de participación: esquema en `draft` y general final (6 rondas, 4-10-2026) publicada el 2026-10-08 como ajuste manual, empates en el orden de la lista oficial |
| Janev Cup | [Competition guide 2026](https://www.cyklokros.cz/files/janev-cup-2026-competition-guide-v23.pdf), actualizada el 1-9-2026 (texto checo en el [rozpis](https://www.cyklokros.cz/files/rozpis-janev-cup-2026-cyklokros-v24.pdf)); [general oficial de Sportsoft](https://cpcx.sportsoft.cz/2026/results.aspx), cuya página se sigue titulando «HSF SYSTEM CUP 2026» | ME, WE | Siete rondas UCI, suma de todas sin descartes; baremo 100, 85, 70, 60, 55, 50, 48, 46, 44, 42, 40 y de uno en uno hasta 1 punto en el puesto 50. Figura en la general quien obtiene puntos en alguna ronda (`awardedAtLeastOnce`). Desempate: última carrera disputada y, sin decidir, la anterior (`latestRoundPoints` con `backwardsUntilDifferent`). El motor compara puntos, por lo que solo se aparta del reglamento si un empatado acaba más allá del puesto 50 en la última carrera y el otro no la corre. Cotejo tras cuatro rondas el 2026-11-02: 69 filas ME y 51 WE, sin diferencias de puesto ni de puntos. MJ queda sin esquema: suma ocho carreras con Prachatice (17-11-2026), prueba nacional fuera del calendario UCI. La clasificación por equipos no está en el modelo |

### Contrato de configuración

El JSON contiene cuatro referencias con `pointsScheme` completo. Copiar ese objeto a la columna JSONB solo tras revisión de edición y categoría; no copiar todo el archivo. `perRank[n-1]` es el valor del puesto n; fuera de tabla, cero. `drops.mode="none"` suma todas; `bestResults` se resuelve por rondas realmente celebradas en esa categoría. `tieBreakers` es una secuencia ordenada, no una cadena de código.

`extras.sprints` usa `unit`, número de premios y fase; la vuelta rápida se declara separada. Modo points añade `bonusPoints` si `extras.pointAdjustments.enabled`; admite penalizaciones negativas verificadas. Modo time resta `bonusSeconds`; nunca usa `PointPcR` como entrada de torneo. Las categorías no definidas quedan ausentes. WU Copa del Mundo está marcada como derivada pendiente de cotejo; los demás esquemas tienen referencia de edición, sin autorización implícita para aplicarlos a otra temporada.

### Validación requerida antes de activar un esquema

Dani autoriza iniciar F2 y continuar F3–F5 el 2026-09-12; [registro de autorización](../plans/cerrados/cc-ciclocross-integracion.md). F5 exige un cotejo por categoría: Copa del Mundo con descartes juveniles y WU derivada, Superprestige incluyendo DNF/DNS, X2O con sprint/vuelta rápida/forfaits, Copa de España con puestos por categoría y sanciones. Revisar reglamentos 2026-27; la autorización de ejecución no convierte estas referencias en reglas verificadas de otra edición.
