# Broadcasts (emisiones TV)

## Orden manual

- **DB:** `broadcasts` con columna `sortOrder` (INTEGER NOT NULL DEFAULT 0).
- **Regla crítica:** el panel DEBE cargar broadcasts con `.order('sortOrder', ascending: true)` al abrir el editor.
- **Guardado seguro en `saveRaceDay` (`js/panel.js`):** leer IDs antiguas → `INSERT` nuevas (UUIDs frescas) → `DELETE` antiguas por ID. Nunca `DELETE` antes del `INSERT` (si la INSERT falla, se pierden los datos). Mismo patrón para `assets`.
- **Canal opcional al guardar:** descartar solo filas completamente vacías. Un canal vacío con solo hora o nota es válido ("Por confirmar").

## Hosts nativos (no SFSafariViewController/CustomTabs)

`youtube.com`, `youtu.be`, `hbomax.com`, `play.max.com` → abrir con `UIApplication.shared.open` (iOS) / `Intent.ACTION_VIEW` (Android). Añadir host nuevo → actualizar `prefersNativeApp` en iOS **y** Android.

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

### Reglas al modificar

- Añadir TZ nueva a un grupo europeo → `_COUNTRY_TZ_MAP` en `js/shared.js`.
- Añadir grupo extracontinental nuevo → `_extracontinentalGroup` en `js/shared.js` + `visibleBroadcastCountries` en `RaceLogic.swift` y `RaceLogic.kt` + CHECK constraints en migraciones + `VALID_COUNTRY_GROUPS` en `send-push/index.ts` + `detectedCountryGroup` en `RegionService.swift` y `RegionDetector.kt`.
- Cambiar whitelist de las apps → `visibleBroadcastCountries` en `RaceLogic.swift` y `RaceLogic.kt`. Mantener paridad con la web.
