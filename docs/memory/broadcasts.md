# Broadcasts (emisiones TV)

## Orden manual

- **DB:** `broadcasts` con columna `sortOrder` (INTEGER NOT NULL DEFAULT 0).
- **Regla crítica:** el panel DEBE cargar broadcasts con `.order('sortOrder', ascending: true)` al abrir el editor.
- **Guardado seguro en `saveRaceDay` (`js/panel/jornada-save.js`):** leer IDs antiguas → `INSERT` nuevas (UUIDs frescas) → `DELETE` antiguas por ID. Nunca `DELETE` antes del `INSERT` (si la INSERT falla, se pierden los datos). Mismo patrón para `assets`.
- **Canal opcional al guardar:** descartar solo filas completamente vacías. Un canal vacío con solo hora o nota es válido ("Por confirmar").

## Automatización desde el VPS

Fuentes oficiales públicas verificadas el 2026-08-25:

- HBO Max: las páginas SSR de deportes y ciclismo exponen UUID, título y
  `eventScheduleDates.startDate` UTC sin login. La reproducción sí requiere cuenta,
  pero la captación de programación no debe almacenar una sesión personal.
- RTVE: programación pública de Teledeporte, La 2 y La 1, con hora peninsular y
  enlace. En La Vuelta se conserva una sola fila `TDP / RTVE Play` desde el inicio
  de Teledeporte y los cambios posteriores se expresan en `note`, por ejemplo
  `Pasa a La 2 a las 16:15.`. No se crean filas separadas para La 1 o La 2.
  A partir de meta estimada +90 minutos, el VPS busca la etapa íntegra en el
  catálogo público de RTVE Play. Cuando la encuentra, esa fila pasa a `RTVE`,
  recibe el enlace específico, `showInRevive=true` y `automationLocked=true`.
- EITB: programación pública de siete días y endpoints HTML por canal/fecha. Puede
  automatizar hora y canal; un deep-link no inequívoco queda en revisión.
- Sporza: páginas estables por ID y texto editorial de hora/canal. Las altas empiezan
  revisadas; una emisión ya vinculada puede actualizarse automáticamente cuando la
  página declara de forma explícita la nueva hora y dos observaciones coinciden.
- RTBF: el endpoint público de programación de La Une y Tipik publica hora con
  offset belga, etapa, duración, tipo/estado y enlace Auvio. Se representa con una
  sola fila `La Une / RTBF Auvio` o `Tipik / RTBF Auvio` en `BE`; los relevos se
  guardan en `note` como `HH:MM > La Une`. RAI usa el mismo formato para el paso
  entre canales (`HH:MM > RAI 2`). Solo `VIDEO/AVAILABLE` íntegro activa Revive y bloqueo.

La automatización necesita tablas separadas de procedencia/vínculo y auditoría. Una
fila solo puede darse de alta automáticamente con host oficial, fecha, hora, canal,
territorio y jornada inequívocos. Las actualizaciones operan únicamente sobre campos
marcados como gestionados, con concurrencia optimista: si la fila ya no coincide con
el último valor aplicado, se interpreta como edición manual y pasa a revisión.

HBO Max crea en una transacción la pareja `Eurosport (HBO Max)`/`EUROPA` y
`TNT Sports (HBO Max)`/`UK_IE`, con la misma hora. Dos observaciones iguales separadas
10–15 minutos confirman un cambio. Nunca borrar automáticamente una emisión que
desaparece de la fuente; marcarla como ausente y revisar. Toda escritura registra
fuente, URL, parser, hash, evidencia de matching y valores anterior/posterior. El
rollback solo se aplica si la fila continúa igual al estado escrito por el sistema.
La nota `La Montonera al terminar.` no se infiere: solo se añade a `EUROPA` cuando
el catálogo contiene un evento independiente de La Montonera para la misma fecha,
carrera y etapa, limitado a Giro, Tour, La Vuelta, Mundial de ruta, Milán-San
Remo, Tour de Flandes y París-Roubaix masculinos. Su ausencia elimina únicamente
esa frase y conserva otras notas.

El servicio y su auditoría privada se validaron en sombra. HBO Max y RTVE operan
en modo de aplicación desde el 2026-08-25; Sporza y RTBF también tienen escritura
habilitada. EITB se incorporará bajo coincidencia inequívoca. Servicio, usuario y
rol de base de datos separados del watcher de resultados.

## Hosts con app nativa preferida

`youtube.com`, `youtu.be`, `hbomax.com`, `play.max.com`, `x.com`, `twitter.com` → intentar primero la app instalada. Sin app receptora, abrir siempre dentro de Calendario Ciclismo mediante `SFSafariViewController` (iOS) o Custom Tabs (Android). iOS usa `.universalLinksOnly`; Android exige una actividad que no sea navegador. Añadir host nuevo → actualizar `prefersNativeApp` en iOS **y** Android.

## Fuentes automáticas

El VPS observa HBO Max, RTVE, EITB, Sporza y RTBF. HBO Max, RTVE,
Sporza y RTBF tienen escritura; EITB usa la parrilla lineal y permanece
en sombra hasta disponer de corroboración ETB ON para altas y diferencias de horario. Sporza separa la hora
deportiva del calendario de la hora editorial de emisión y solo acepta esta
última cuando la página oficial declara también el canal. EITB no escribe sin
deep-link de ETB ON y Sporza guarda la ruta estable `~matchId` de la etapa.
El colector de Caracol se retiró el 2026-09-29; las filas `Caracol / Ditu`
existentes se editan a mano.
RTBF consulta La Une y Tipik con paginación completa en una ventana -7/+8 días, descarta
resúmenes cortos y reconoce los vídeos íntegros de Auvio como cierre Revive.
Los enlaces `https://etbon.eus/m/...` se consideran `Revive` automáticamente en
web, Android e iOS; los hubs `/ch/` no. HBO Max y las redes sociales con vídeo
persistente también son Revive por tipo de enlace. `broadcasts.showInRevive=true`
es la regla remota autoritativa para RTVE y cualquier fuente
presente o futura que no pueda inferirse por URL. El sincronizador acepta
`reviveCapable=true` en una observación y lo materializa en `showInRevive` al
crear o actualizar la emisión; nunca retira una marca Revive existente.

## Embed YouTube en web (`broadcasts.embeddable`)

`BOOLEAN nullable`. Al guardar en panel se valida la URL contra `https://www.youtube.com/oembed` (`checkYouTubeEmbeddable` en `js/shared.js`). 200 → `true`, 401/404 → `false`, red/CORS → `null`. Solo se revalida cuando la URL cambia. `js/jornada.js` monta el iframe inline solo si `b.embeddable !== false`; cuando es `false` el botón "Ver" abre en pestaña nueva. El editor muestra `⚠ Embed deshabilitado en YouTube`.

## Grupos regionales (`broadcasts.country`) — 17 valores

Migración: `038_broadcasts_country_groups.sql`.

| Grupo | Cobertura | Canales típicos |
|---|---|---|
| `ALL` | Mundial / sin restricción geo | YouTube oficial UCI, organizadores |
| `EUROPA` | Pan-europeo | **Eurosport / HBO Max / Max**, TNT Sports paneuropeo |
| `ES` | España | RTVE Play, Teledeporte, Esport3, ETB1, TVG, A Galega, RTPA, Canal Deporte, G2 |
| `PT` | Portugal | RTP, RTP Play |
| `FR` | Francia | France 2, France 3, France TV, L'Équipe |
| `BE` | Bélgica | RTBF Auvio, La Une, Tipik, Sporza, VRT, Eén, Canvas |
| `NL` | Países Bajos | NOS, NPO 1/2/3 |
| `IT` | Italia | RAI 1/2/Sport, RaiPlay |
| `DE_AT_CH` | Alemania / Austria / Suiza | ARD, ZDF, Eurosport DE, ORF, ServusTV, SRF, RTS |
| `UK_IE` | Reino Unido / Irlanda | TNT Sports UK, ITV4, BBC, RTÉ, Discovery+ UK |
| `SCANDI` | Nórdicos | TV2 (DK/NO), DR, NRK, SVT, YLE, Viaplay |
| `EE` | Europa del Este | TVP (PL), ČT (CZ), RTVS (SK), RTV SLO (SI), HRT (HR), MTVA (HU), TVR (RO), BNT (BG), ERR (EE), LTV (LV), LRT (LT), RTS (RS), BHRT (BA), MRT (MK), RTCG (ME), RTSH (AL), TRT (TR), ERT (GR) |
| `LATAM` | América Latina | ESPN Latam, Star+, Claro Sports, TyC Sports |
| `NORTEAM` | EE.UU. + Canadá | FloBikes, Peacock, TrillerTV, Discovery+ US, NBC Sports, CBC |
| `ASIAPAC` | Asia / Pacífico | J Sports (JP), SBS (AU), Sky Sport NZ, CCTV (CN), KBS/SBS (KR), Astro (MY) |
| `AFRICA` | África subsahariana | SuperSport, broadcasters locales |
| `MENA` | Oriente Medio + Norte de África | beIN Sports, Algerie TV, Oman TV, Al Kass, Dubai Sports |

### Reglas para Claude Chat al introducir broadcasts

- Siempre rellenar `country`.
- **Eurosport / HBO Max / Max → `EUROPA`** (paneuropeo). Excepción: TNT Sports UK → `UK_IE`.
- **YouTube oficial / streams del organizador → `ALL`**.
- Fuentes: webs oficiales de organizadores y cadenas.

## Filtro por región en cliente

### Web (`js/shared.js → filterBroadcastsByRegion`)

Filtro estricto por TZ del usuario:
- Usuario europeo: `ALL + EUROPA + (su grupo si está cubierto)`.
- Usuario fuera de Europa: `ALL + (su grupo si está cubierto)` — sin `EUROPA`.

### Apps iOS/Android (`RaceLogic.filterBroadcastsByRegion`)

Por defecto: `ALL + ES + EUROPA`. La preferencia regional del usuario amplía ese conjunto y es gratuita desde 4.3. Ver `docs/memory/i18n-region.md`.

Jornada conserva además la lista completa sin filtrar para el selector «Todas». El modo regional es el estado inicial; «Todas» muestra las emisiones restantes y añade un badge territorial a toda emisión restringida, incluidas las que ya pertenecían a la región elegida. `ALL` no lleva badge. La web aplica la misma regla al activar su selector existente. Los badges traducen sus códigos de presentación sin alterar los valores almacenados: en castellano, `UK_IE` → `GB / IRL` y `SCANDI` → `ESCANDI`; en inglés, `EUROPA` → `EUROPE`, `UK_IE` → `UK / IRL` y `NORTEAM` → `NORTH AM.`.

### Reglas al modificar

- Añadir TZ nueva a un grupo europeo → `_COUNTRY_TZ_MAP` en `js/shared.js`.
- Añadir grupo extracontinental nuevo → `_extracontinentalGroup` en `js/shared.js` + `visibleBroadcastCountries` en `RaceLogic.swift` y `RaceLogic.kt` + CHECK constraints en migraciones + `VALID_COUNTRY_GROUPS` en `send-push/index.ts` + `detectedCountryGroup` en `RegionService.swift` y `RegionDetector.kt`.
- Cambiar whitelist de las apps → `visibleBroadcastCountries` en `RaceLogic.swift` y `RaceLogic.kt`. Mantener paridad con la web.
