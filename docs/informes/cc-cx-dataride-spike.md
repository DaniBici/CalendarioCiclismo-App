# CC-CX F1: comprobación de resultados DataRide

Fecha de consulta: 2026-09-12. Operación de solo lectura, sin altas ni resultados en Supabase. Fuente: [DataRide UCI](https://dataride.uci.ch/). Evidencia compacta: [cc-cx-dataride-spike.json](cc-cx-dataride-spike.json). Contrato observado, sujeto a cambios del proveedor.

Esta prueba comprueba el servicio de resultados, no la fuente del calendario. Las carreras se importan desde la [sección Calendar de ciclocross de la web UCI](https://www.uci.org/discipline/cyclo-cross/27qDl3RfvZBNwx1GhqJTwj?tab=calendar). DataRide permite localizar sus resultados y los identificadores necesarios para enlazarlos. Que una carrera todavía no figure en DataRide no impide importarla desde el calendario oficial.

## Reproducción

```sh
node tools/spikes/cc-cx-dataride.mjs /tmp/cc-cx-f1-spike
# Completar una ejecución interrumpida reutilizando las respuestas locales:
node tools/spikes/cc-cx-dataride.mjs /tmp/cc-cx-f1-spike --resume
```

Node con fetch nativo, sin dependencias, credenciales ni conexión a Supabase. El script consulta 472 y una muestra complementaria 455. Conserva respuestas crudas en el directorio indicado; nunca escribe cookies. No es el importador de F2. Las respuestas de una temporada anterior solo validan estructura y cobertura histórica.

## Peticiones reales

Base: `https://dataride.uci.ch/iframe/`. POST `application/x-www-form-urlencoded`, `X-Requested-With: XMLHttpRequest`, User-Agent del bot del proyecto. Sembrar sesión con GET a la raíz y conservar Set-Cookie solo en memoria para Events. En las muestras CX consultadas, Events también respondió sin Cookie; no generalizar este comportamiento a carretera.

| Endpoint | Parámetros | Respuesta |
| --- | --- | --- |
| GET `GetDisciplineSeasons/?disciplineId=3` | disciplina CX | array de temporadas |
| POST `Competitions/` | `disciplineId=3`; paginación; filtros posicionales inferiores | `{data: [...], total: N}` |
| POST `Races/` | `disciplineId=3`, `competitionId=CompetitionId`; paginación | `{data: [...], total: N}` |
| POST `Events/` | `disciplineId=3`, `raceId=Races.Id` | array de eventos |
| POST `Results/` | `disciplineId=3`, `eventId=Events.EventId`; paginación | `{data: [...], total: N}` |

Paginación usada: `take=500&skip=0&page=1&pageSize=500`. Comparar `total` con filas recibidas, también en Races y Results; paginar si faltan. Payload validado de Competitions:

```text
disciplineId=3
take=500
skip=0
page=1
pageSize=500
sort[0][field]=StartDate
sort[0][dir]=desc
filter[filters][0][field]=RaceTypeId
filter[filters][0][value]=0
filter[filters][1][field]=CategoryId
filter[filters][1][value]=0
filter[filters][2][field]=SeasonId
filter[filters][2][value]=472
```

El endpoint no interpreta todos los payloads Kendo de forma intercambiable: sin filtros devuelve cero competiciones; añadir `filter[logic]=and` y operadores `eq` al payload anterior produjo HTML con HTTP 200. Comprobar JSON y forma, no solo el estado HTTP. No interpretar un error HTML como temporada vacía.

## Temporada y disponibilidad en el servicio de resultados

`GetDisciplineSeasons(3)` confirma 472 → `Year=2027`, 455 → 2026, 443 → 2025. La clave propia 2026-27 se ancla a 2026; no usar Year como año inicial. La temporada 472 expone únicamente:

| CompetitionId | CompetitionName | ClassCode | Date |
| --- | --- | --- | --- |
| 78518 | New Zealand National Championships | CN | 31 Aug 2026 |
| 79380 | Chilean National Championships | CN | 22 Aug 2026 |

Ambas fueron recorridas hasta Results. Nueva Zelanda contiene cinco categorías y 19 filas; Chile dos categorías y ocho filas. La existencia de filas no acredita una clasificación oficial: comprobar sus puestos/estados y cotejar la publicación del organizador. La consulta de revisión F5 del 12-09-2026 confirma nueve puestos en MJ/WE/WJ de Nueva Zelanda, todos sin tiempo; ME/MU siguen sin puestos. Se corrige la afirmación anterior de que todas sus filas tenían el puesto vacío. `IsDone=false` tampoco certifica publicación. No oficializar por mera existencia de eventos/filas.

La consulta 455 devuelve 189 competiciones, con seis clases. Es una muestra complementaria para comprobar la estructura del servicio de resultados. `Competitions/` no se usa como fuente de importación del calendario. El listado reducido de 472 no es un impedimento para importar las pruebas 2026-27 desde la web UCI. No trasladar pruebas de 2025-26 a 2026-27 ni interpretar su ausencia en DataRide como ausencia del calendario oficial.

## Clases y nombres

| Clase | CompetitionId (455) | Nombre real de muestra |
| --- | --- | --- |
| CM | 75924 | 2026 Rabobank UCI Cyclo-cross World Championships |
| CDM | 75908 | 2025-2026 UCI Cyclo-cross World Cup #12, Hoogerheide |
| C1 | 78080 | Internationale Sluitingsprijs - Oostmalle |
| C2 | 75880 | Waaslandcross |
| CN | 75953 | Greek National Championships |
| CC | 75830 | UEC Cyclo-cross European Championships |
| CC | 75817 | Pan American Cyclo-Cross Championships |

`CC` queda confirmado contra API real en dos confederaciones. No requiere alias a CM. `NAC` es código propio: no aparece en estos catálogos. Los nombres incluyen patrocinador, edición y número de ronda; no sirven como identificador persistente ni garantizan un torneo. El catálogo también incluye rondas UCI de Copa de España como C2; la presencia de esas rondas no cubre categorías nacionales ni su general RFEC.

Campos de Competition: `CompetitionId`, `CompetitionName`, `StartDate`, `EndDate`, `Date`, `ClassCode`, `CountryName`, `CountryIsoCode2`, `CountryIsoCode3`, `FlagCode`, `IsInProgress`, `IsDone`. No devuelve `Id`, horarios, torneo, URL oficial, logo ni estado editorial.

## Categorías y multidía

| Races.CategoryCode | Categoría propia | Ejemplo RaceId |
| --- | --- | --- |
| Men Elite | ME | 244559 |
| Women Elite | WE | 244560 |
| Men Under 23 | MU | 244563 |
| Women Under 23 | WU | 244564 |
| Men Junior | MJ | 244561 |
| Women Junior | WJ | 244562 |

Los seis ejemplos son del Mundial 75924. `RaceName` coincide con CategoryCode en la muestra. `RaceTypeCode=CRO-IND`, `DisciplineCode=CRO`. No convertir Index en número de etapa ni crear jornadas. Copa del Mundo Tábor y Hoogerheide publican ME/WE/MU/MJ/WJ, sin manga WU separada: no inventarla.

Mundial: MJ/ME/WU el 01-02-2026; WE/WJ/MU el 31-01-2026. La séptima Race es `Mixed Elite`, `CRO-TR`, RaceId 244565, el 30-01-2026: excluir del modelo de seis categorías v1 y registrar la exclusión; jamás mapear a ME. Europeo y Panamericano publican las seis categorías.

Campos de Race: `Id`, `RaceCode`, `Index`, `StartDate`, `EndDate`, `RaceName`, `CategoryCode`, `RaceTypeCode`, `DisciplineCode`, `StartLocation`, `EndLocation`, `MandatoryDate`, `EventResultPage`, `Venue`, `Date`. Fechas .NET `/Date(ms)/`, con desplazamiento respecto de la medianoche civil. Preferir Date textual para el día indicado por DataRide; no convertirla en hora de salida ni inferir la zona IANA. En el Europeo, Date y MandatoryDate discrepan: cotejar el programa oficial antes de fijar un override multidía. Events contiene fechas centinela del año 1.

## Eventos y resultados

Cada Race de la muestra expone un evento `General Classification`; el relevo también usa ese nombre. Resolver categoría en el padre Race, nunca en EventName ni en Gender del resultado. `EventId` es la clave útil. `RaceId`, `CompetitionId` y `DisciplineId` del evento valen 0; `Items=[]`, `Total=0`, `DisplayInfo=01 Jan 0001` no describen sus resultados. Consultar Results separadamente. `WinnerName` puede estar poblado incluso con resultados sin puestos.

| Campos de Result | Uso y límites |
| --- | --- |
| ResultId / SortOrder | ID de fuente y orden estable de fila |
| RankNumber / Rank | número y texto; pueden ser NULL/vacío; preservar ambos |
| Bib | texto nullable; nunca generar dorsales |
| DisplayName / IndividualDisplayName | apellido en mayúsculas seguido de nombre; disponibles |
| DisplayFirstName/LastName, IndividualFirstName/LastName | campos presentes pero vacíos en todas las muestras; separación requiere matching o parser |
| BirthDate / Age | fecha .NET y edad textual; conservar fecha civil y rechazar centinelas |
| IsoCode2 / IndividualCountryIsoCode2 | nacionalidad ISO2 |
| NationName / IndividualCountryName | ISO3 con espacios; CountryNameText ofrece nombre largo |
| TeamName / TeamType | equipo opcional; no deducir IsTeamEvent de TeamType |
| ResultValue | tiempo absoluto `h:mm:ss`, texto `-1 LAP`/`-N LAPS` o vacío en la muestra; conservar original; no tratar vueltas perdidas como segundos |
| PointPcR / TeamPointPcR, PcRPrefix/PcRSuffix | puntos UCI y presentación; no puntos de torneo ni bonos X2O |
| Irm | DNF, DNS, DSQ, LAP observados; LAP puede conservar rank positivo |
| Gender / IndividualGender / UnknownIndividualGender | vacíos; categoría del padre gobierna género |
| UnknownIndividual*, Phase, Heat, FlagCode, MandatoryDate | campos disponibles; varios nulos; ninguna marca de official/provisional |

No aparecen UCI ID/licencia, UCI profile ID, splits por vuelta, sprints, bonificaciones, horario de salida, URL de inscritos ni TV. Matching propio contra cx_riders_* por identidad verificada; ResultId no es ID de corredor. No enlazar con fichas de carretera. Conservar IRM y filas sin tiempo; no convertir LAP en DNF ni asignar un tiempo real a un doblado.

Koppenberg 75808 fue recorrido en sus cuatro categorías: solo General Classification; no eventos ni campos de sprint/vuelta rápida. [Resultados oficiales de la ronda](https://koppenbergcross.be/uitslagen-elite-mannen/) muestran meta, tiempos y vueltas perdidas, sin detalle de las bonificaciones. El [estudio de puntuación](../memory/ciclocross.md#esquemas-de-puntos-de-torneos) describe la captura pendiente y la corrección de unidades X2O.

## Puerta de F2

Dani autoriza iniciar F2 y continuar F3–F5 el 2026-09-12; [registro de autorización](../plans/cerrados/cc-ciclocross-integracion.md). Pendientes explícitos: fuente verificable de bonificaciones por ronda X2O, revisión de los reglamentos 2026-27 cuando estén publicados y generales de categorías que compiten agrupadas. F2 verificará e importará el calendario desde la web UCI; no requiere ampliar el listado 472 de DataRide. F1 no ejecutó importador, panel, cron ni recálculo.

## Revisión F5 del fetcher (12-09-2026)

Consulta real con `disciplineId=3`, sin escritura en Supabase: Waaslandcross 75880/455 devuelve 103 filas en ME/MJ/WE/WJ, con tiempos absolutos e IRM; Nueva Zelanda 78518/472 devuelve las 19 filas indicadas arriba. En MJ/WE/WJ, `Rank` y `RankNumber` coinciden; no se atribuye esta corrección de lectura a un cambio de la API. No aparece una marca de publicación oficial ni un bono X2O utilizable. La muestra 455 solo comprueba el formato: no se importa historia ni se traslada a 2026-27.

[Registro de identificadores, fecha de consulta y recuentos](cc-cx-dataride-recheck-20260912.json). El nuevo fetcher recorre todas las páginas, categoriza en el padre Race, excluye formatos no admitidos y conserva los bonos desconocidos como NULL. [Importación y protección de resultados](../runbooks/cc-cx-results-pipeline.md).

Revisión WE Copa del Mundo 455, 12-09-2026: las doce rondas devuelven 752 filas con nacimiento completo, contrastadas contra sus PDF oficiales por dorsal, puesto, nombre, nacionalidad y año. En 127 filas el PDF acredita LAP mientras la respuesta normalizada DataRide tiene puesto, tiempo desconocido e IRM vacío. No interpretar ese vacío como tiempo válido ni afirmar que DataRide publicó el estado; el cotejo offline usa el PDF. No se ingieren estos resultados ni se crean identidades. Fuentes/hash y una contradicción de puesto entre PDF de ronda/general en [cc-cx-cotejos.md](cc-cx-cotejos.md).
