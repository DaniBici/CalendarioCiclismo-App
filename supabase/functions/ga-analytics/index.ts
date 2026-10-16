// ─────────────────────────────────────────────────────────────────
//  Edge Function: ga-analytics
//  Proxy para consultar la Google Analytics Data API (GA4).
//  Usa una Service Account para autenticarse con Google.
//
//  Variables de entorno necesarias (Supabase Dashboard → Settings → Edge Functions):
//    GA_PROPERTY_ID           — ID numérico de la propiedad GA4 web (ej: 531157512)
//    GA_APP_PROPERTY_ID       — (opcional) ID de la propiedad GA4 de las apps nativas
//                               Si se define, los informes combinan ambas propiedades.
//    GA_SERVICE_ACCOUNT_EMAIL — Email de la service account
//    GA_PRIVATE_KEY           — Clave privada RSA (PEM) de la service account
//
//  Auth: sesión de administrador (private.admin_users, vía RPC
//  public.is_admin), salvo el informe público portfolio_stats.
// ─────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

// ── Verify Supabase JWT + administración ────────────────────────
// Una sesión válida no basta: el usuario debe figurar en
// private.admin_users. public.is_admin() se consulta con el JWT del propio
// usuario y por GET (el pre-request de PostgREST solo bloquea escrituras).
// Cualquier error o respuesta distinta de true se trata como no admin.
async function verifyAuth(req: Request): Promise<401 | 403 | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return 401;
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 401;
  const { data: isAdmin, error } = await supabase.rpc('is_admin', undefined, { get: true });
  return !error && isAdmin === true ? null : 403;
}

function jsonRes(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// ── Base64url helpers ────────────────────────────────────────────
function base64url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const binStr = Array.from(bytes, b => String.fromCharCode(b)).join('');
  return btoa(binStr).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── Import PEM private key for RS256 ─────────────────────────────
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemBody = pem
    .replace(/\\n/g, '\n')                       // literal \n → newline
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const binaryDer = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

// ── Create signed JWT for Google Service Account ─────────────────
async function getGoogleAccessToken(email: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${header}.${payload}`;
  const key = await importPrivateKey(privateKeyPem);
  const sig = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput)),
  );
  const jwt = `${signingInput}.${base64url(sig)}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error(`Google token error: ${JSON.stringify(tokenData)}`);
  }
  return tokenData.access_token;
}

// ── GA4 report types ─────────────────────────────────────────────
interface GADimensionValue { value: string }
interface GAMetricValue    { value: string }
interface GARow {
  dimensionValues?: GADimensionValue[];
  metricValues:     GAMetricValue[];
}
interface GAReport {
  dimensionHeaders?: { name: string }[];
  metricHeaders?:    { name: string; type: string }[];
  rows?:             GARow[];
  rowCount?:         number;
  [key: string]:     unknown;
}

// ── Merge two GA4 runReport responses ────────────────────────────
// Suma métricas por clave de dimensión. Para informes sin dimensiones
// (overview) suma directamente los valores de la única fila.
// Nota: activeUsers puede estar levemente inflado si un mismo usuario
// usa ambas plataformas (limitación inherente a propiedades separadas).
function mergeGAReports(a: GAReport, b: GAReport): GAReport {
  const aRows = a.rows ?? [];
  const bRows = b.rows ?? [];

  if (aRows.length === 0 && bRows.length === 0) return { ...a, rows: [], rowCount: 0 };
  if (aRows.length === 0) return b;
  if (bRows.length === 0) return a;

  const hasDimensions = (a.dimensionHeaders ?? []).length > 0;

  if (!hasDimensions) {
    // Overview: una sola fila.
    // Las métricas sumables se suman directamente. Las métricas de tipo media/tasa
    // (averageSessionDuration, bounceRate) deben ponderarse por sesiones — sumarlas
    // produciría un valor hasta el doble del real.
    // Para el report 'overview', el orden de métricas es:
    //   0: activeUsers  1: sessions  2: screenPageViews
    //   3: averageSessionDuration  4: bounceRate  5: newUsers
    const aMetrics = aRows[0].metricValues.map(mv => Number(mv.value));
    const bMetrics = (bRows[0]?.metricValues ?? []).map(mv => Number(mv.value));

    const sessionsA    = aMetrics[1] ?? 0;
    const sessionsB    = bMetrics[1] ?? 0;
    const totalSessions = sessionsA + sessionsB;

    const mergedValues = aMetrics.map((aVal, i) => {
      const bVal = bMetrics[i] ?? 0;
      // Índices 3 (averageSessionDuration) y 4 (bounceRate): media ponderada por sesiones.
      if ((i === 3 || i === 4) && totalSessions > 0) {
        return { value: String((sessionsA * aVal + sessionsB * bVal) / totalSessions) };
      }
      return { value: String(aVal + bVal) };
    });
    return { ...a, rows: [{ metricValues: mergedValues }], rowCount: 1 };
  }

  // Informes con dimensiones: agrupar por clave de dimensión y sumar métricas.
  const map = new Map<string, number[]>();
  const addRows = (rows: GARow[]) => {
    for (const row of rows) {
      const key     = (row.dimensionValues ?? []).map(d => d.value).join('\x00');
      const metrics = row.metricValues.map(m => Number(m.value));
      const prev    = map.get(key);
      map.set(key, prev ? prev.map((v, i) => v + (metrics[i] ?? 0)) : metrics);
    }
  };
  addRows(aRows);
  addRows(bRows);

  const rows: GARow[] = Array.from(map.entries())
    .map(([key, metrics]) => ({
      dimensionValues: key.split('\x00').map(v => ({ value: v })),
      metricValues:    metrics.map(v => ({ value: String(v) })),
    }))
    .sort((r1, r2) => Number(r2.metricValues[0].value) - Number(r1.metricValues[0].value));

  return { ...a, rows, rowCount: rows.length };
}

// ── Predefined report configurations ─────────────────────────────
type ReportType = 'overview' | 'top_pages' | 'top_screens' | 'traffic_sources' | 'top_countries' | 'devices' | 'peak_hour' | 'daily_pageviews' | 'weekly_pageviews' | 'platforms' | 'platform_detail' | 'top_races' | 'top_stages' | 'app_content';

function buildReportBody(
  reportType: ReportType,
  dateRange: { startDate: string; endDate: string },
): Record<string, unknown> {
  const range = { dateRanges: [dateRange] };

  switch (reportType) {
    case 'overview':
      return {
        ...range,
        metrics: [
          { name: 'activeUsers' },
          { name: 'sessions' },
          { name: 'screenPageViews' },
          { name: 'averageSessionDuration' },
          { name: 'bounceRate' },
          { name: 'newUsers' },
        ],
      };

    case 'top_pages':
      return {
        ...range,
        dimensions: [{ name: 'pagePath' }],
        metrics: [
          { name: 'screenPageViews' },
          { name: 'activeUsers' },
          { name: 'averageSessionDuration' },
        ],
        dimensionFilter: {
          andGroup: {
            expressions: [
              {
                notExpression: {
                  filter: {
                    fieldName: 'pagePath',
                    stringFilter: { matchType: 'EXACT', value: '(not set)' },
                  },
                },
              },
              {
                notExpression: {
                  filter: {
                    fieldName: 'pagePath',
                    stringFilter: { matchType: 'EXACT', value: '' },
                  },
                },
              },
            ],
          },
        },
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: 100,
      };

    case 'top_screens':
      return {
        ...range,
        dimensions: [{ name: 'unifiedScreenName' }],
        metrics: [
          { name: 'screenPageViews' },
          { name: 'activeUsers' },
          { name: 'averageSessionDuration' },
        ],
        dimensionFilter: {
          andGroup: {
            expressions: [
              {
                notExpression: {
                  filter: {
                    fieldName: 'unifiedScreenName',
                    stringFilter: { matchType: 'EXACT', value: '(not set)' },
                  },
                },
              },
              {
                notExpression: {
                  filter: {
                    fieldName: 'unifiedScreenName',
                    stringFilter: { matchType: 'EXACT', value: '' },
                  },
                },
              },
            ],
          },
        },
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: 20,
      };

    case 'traffic_sources':
      return {
        ...range,
        dimensions: [{ name: 'sessionSource' }],
        metrics: [
          { name: 'sessions' },
          { name: 'activeUsers' },
          { name: 'bounceRate' },
          { name: 'screenPageViews' },
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 10,
      };

    case 'top_countries':
      return {
        ...range,
        dimensions: [{ name: 'country' }],
        metrics: [
          { name: 'activeUsers' },
          { name: 'sessions' },
        ],
        orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
        limit: 10,
      };

    case 'devices':
      return {
        ...range,
        dimensions: [{ name: 'deviceCategory' }],
        metrics: [
          { name: 'activeUsers' },
          { name: 'sessions' },
        ],
        orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
      };

    case 'peak_hour':
      return {
        ...range,
        dimensions: [{ name: 'hour' }, { name: 'platform' }],
        metrics: [
          { name: 'activeUsers' },
          { name: 'sessions' },
        ],
        orderBys: [{ dimension: { dimensionName: 'hour' } }],
        limit: 200,
      };

    case 'daily_pageviews':
      return {
        ...range,
        dimensions: [{ name: 'date' }, { name: 'platform' }],
        metrics: [
          { name: 'screenPageViews' },
          { name: 'activeUsers' },
        ],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
        limit: 2000,
      };

    // Igual que daily_pageviews pero agregado por SEMANA ISO directamente en
    // GA4 (dimensión `isoWeek`, formato "YYYYWW"). Necesario porque activeUsers
    // no es sumable entre días: un usuario que vuelve varias veces en la misma
    // semana contaría varias veces si se sumaran sus días por separado (así lo
    // hacía el cliente antes, sobrecontando frente al KPI "Usuarios" real).
    // Aquí es GA4 quien deduplica dentro de cada semana, igual que hace para
    // el rango completo en 'overview'.
    case 'weekly_pageviews':
      return {
        ...range,
        dimensions: [{ name: 'isoWeek' }, { name: 'isoYear' }, { name: 'platform' }],
        metrics: [
          { name: 'screenPageViews' },
          { name: 'activeUsers' },
        ],
        orderBys: [
          { dimension: { dimensionName: 'isoYear' } },
          { dimension: { dimensionName: 'isoWeek' } },
        ],
        limit: 500,
      };

    case 'platforms':
      return {
        ...range,
        dimensions: [{ name: 'platform' }],
        metrics: [
          { name: 'activeUsers' },
          { name: 'sessions' },
          { name: 'screenPageViews' },
          { name: 'newUsers' },
          { name: 'averageSessionDuration' },
        ],
        orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
      };

    case 'platform_detail':
      return {
        ...range,
        dimensions: [{ name: 'platform' }, { name: 'deviceCategory' }],
        metrics: [
          { name: 'activeUsers' },
          { name: 'sessions' },
        ],
        orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
      };

    case 'top_races':
      return {
        ...range,
        dimensions: [
          { name: 'customEvent:race_id' },
          { name: 'customEvent:race_name' },
        ],
        metrics: [
          { name: 'screenPageViews' },
          { name: 'activeUsers' },
        ],
        dimensionFilter: {
          filter: {
            fieldName: 'eventName',
            stringFilter: { matchType: 'EXACT', value: 'screen_view' },
          },
        },
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: 15,
      };

    case 'top_stages':
      return {
        ...range,
        dimensions: [
          { name: 'customEvent:stage_name' },
          { name: 'customEvent:race_name' },
          { name: 'customEvent:race_day_id' },
        ],
        metrics: [
          { name: 'screenPageViews' },
          { name: 'activeUsers' },
        ],
        dimensionFilter: {
          andGroup: {
            expressions: [
              {
                filter: {
                  fieldName: 'eventName',
                  stringFilter: { matchType: 'EXACT', value: 'screen_view' },
                },
              },
              // Excluir pantallas sin carrera (Hoy, Buscar, Ajustes, feed…), que de
              // otro modo dominan la tabla bajo (not set). Filtramos por race_day_id,
              // NO por stage_name: las pruebas de un día (clásicas, Campeonatos
              // Nacionales) tienen stage_name vacío pero race_day_id poblado, así que
              // filtrar por stage_name las descartaba injustamente. Con race_day_id
              // entran y se agrupan por su jornada única.
              {
                notExpression: {
                  filter: {
                    fieldName: 'customEvent:race_day_id',
                    stringFilter: { matchType: 'EXACT', value: '(not set)' },
                  },
                },
              },
              {
                notExpression: {
                  filter: {
                    fieldName: 'customEvent:race_day_id',
                    stringFilter: { matchType: 'EXACT', value: '' },
                  },
                },
              },
            ],
          },
        },
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: 15,
      };

    default:
      throw new Error(`Tipo de informe no soportado: ${reportType}`);
  }
}

// ── Contenidos de las apps ───────────────────────────────────────
// Ranking único de lo que se ve en las apps. Cada elemento agrupa todas las
// pantallas que le pertenecen para que cuente como un solo contenido:
//   - race:          una carrera de un día con su ficha, inscritos,
//                    clasificación, orden de salida, perfil y mapa (agrupadas
//                    por race_name).
//   - stage:         una etapa de una vuelta por etapas con su jornada,
//                    clasificaciones, orden de salida, perfil y mapa
//                    (agrupadas por race_day_id).
//   - race_info:     la carrera de una vuelta por etapas fuera de sus etapas:
//                    ficha e inscritos. La lista de inscritos es de toda la
//                    carrera y no se reparte entre etapas.
//   - cx_race:       una carrera de ciclocross con todas sus categorías.
//   - cx_tournament: la página de un torneo de ciclocross.
//   - tab:           una pestaña global: Ciclocross; Resultados, con sus
//                    secciones Últimos resultados, Ciclocross y Ránking UCI
//                    (la misma pestaña); Fichajes, con su detalle de equipo.
//   - cx_unnamed:    fichas y torneos de ciclocross de apps anteriores a la
//                    5.1.1, que registraban la plantilla de la ruta sin
//                    identidad.
// Cada consulta deduplica los usuarios dentro de su grupo; sumar usuarios de
// pantallas distintas los contaría dos veces.
// Pantallas de una jornada concreta (llevan race_day_id) y de la carrera.
const ROAD_DAY_SCREENS = ['stage_detail', 'results', 'start_order', 'elevation_profile', 'route_map'];
const ROAD_RACE_LEVEL_SCREENS = ['race_detail', 'startlist'];
const ROAD_RACE_SCREENS = [...ROAD_RACE_LEVEL_SCREENS, ...ROAD_DAY_SCREENS];

interface AppContentItem {
  kind: 'race' | 'stage' | 'race_info' | 'cx_race' | 'cx_tournament' | 'tab' | 'cx_unnamed';
  name: string;
  views: number;
  users: number;
}

function gaNotEmpty(fieldName: string): Record<string, unknown> {
  return {
    andGroup: {
      expressions: ['(not set)', ''].map((value) => ({
        notExpression: { filter: { fieldName, stringFilter: { matchType: 'EXACT', value } } },
      })),
    },
  };
}

function gaAnd(...expressions: Record<string, unknown>[]): Record<string, unknown> {
  return { andGroup: { expressions } };
}

function gaOr(...expressions: Record<string, unknown>[]): Record<string, unknown> {
  return { orGroup: { expressions } };
}

function gaScreenIn(values: string[]): Record<string, unknown> {
  return { filter: { fieldName: 'unifiedScreenName', inListFilter: { values } } };
}

async function buildAppContent(
  accessToken: string,
  propertyId: string,
  dateRange: { startDate: string; endDate: string },
): Promise<AppContentItem[]> {
  const metrics = [{ name: 'screenPageViews' }, { name: 'activeUsers' }];
  const orderBys = [{ metric: { metricName: 'screenPageViews' }, desc: true }];

  // Una dimensión personalizada sin registrar en GA4 devuelve 400: la consulta
  // queda vacía y el resto del ranking se conserva.
  const run = async (body: Record<string, unknown>, customDimensions: boolean): Promise<GARow[]> => {
    const res = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateRanges: [dateRange], metrics, ...body }),
      },
    );
    if (!res.ok) {
      const errText = await res.text();
      if (customDimensions && res.status === 400 && /not a valid dimension|INVALID_ARGUMENT/i.test(errText)) {
        console.warn(`[ga-analytics] app_content: dimensiones custom no registradas en GA4 (property ${propertyId}).`);
        return [];
      }
      throw new Error(`GA API error ${res.status} (property ${propertyId}): ${errText.slice(0, 300)}`);
    }
    return ((await res.json()) as GAReport).rows ?? [];
  };

  const dayFilter = gaAnd(gaScreenIn(ROAD_DAY_SCREENS), gaNotEmpty('customEvent:race_day_id'));
  const noDay = { filter: { fieldName: 'customEvent:race_day_id', inListFilter: { values: ['(not set)', ''] } } };

  const [dayTotals, dayNames, raceTotals, raceInfo, cxRaces, cxTournaments, cyclocross, results, transfers, unnamed] = await Promise.all([
    // Usuarios y vistas de cada jornada, deduplicados por race_day_id.
    run({ dimensions: [{ name: 'customEvent:race_day_id' }], dimensionFilter: dayFilter, orderBys, limit: 250 }, true),
    // Nombre de la carrera y de la etapa de cada jornada. El nombre de etapa
    // llega localizado («Etapa 3», «Stage 3»): se conserva el de más vistas.
    run({
      dimensions: [{ name: 'customEvent:race_day_id' }, { name: 'customEvent:race_name' }, { name: 'customEvent:stage_name' }],
      dimensionFilter: dayFilter, orderBys, limit: 1000,
    }, true),
    // Carrera completa (todas sus pantallas), para las pruebas de un día.
    run({
      dimensions: [{ name: 'customEvent:race_name' }],
      dimensionFilter: gaAnd(gaScreenIn(ROAD_RACE_SCREENS), gaNotEmpty('customEvent:race_name')),
      orderBys, limit: 100,
    }, true),
    // Ficha e inscritos de la carrera (más las clasificaciones sin jornada).
    run({
      dimensions: [{ name: 'customEvent:race_name' }],
      dimensionFilter: gaAnd(
        gaNotEmpty('customEvent:race_name'),
        gaOr(gaScreenIn(ROAD_RACE_LEVEL_SCREENS), gaAnd(gaScreenIn(['results']), noDay)),
      ),
      orderBys, limit: 100,
    }, true),
    run({
      dimensions: [{ name: 'customEvent:race_id' }, { name: 'customEvent:race_name' }],
      dimensionFilter: { andGroup: { expressions: [gaScreenIn(['cx_race']), gaNotEmpty('customEvent:race_id')] } },
      orderBys, limit: 100,
    }, true),
    run({
      dimensions: [{ name: 'customEvent:race_id' }, { name: 'customEvent:race_name' }],
      dimensionFilter: { andGroup: { expressions: [gaScreenIn(['cx_tournament']), gaNotEmpty('customEvent:race_id')] } },
      orderBys, limit: 100,
    }, true),
    // Las pestañas globales se consultan sin dimensión: una sola fila con los
    // usuarios deduplicados entre todas las pantallas del grupo.
    run({ dimensionFilter: gaScreenIn(['cyclocross']) }, false),
    run({ dimensionFilter: gaScreenIn(['results_feed', 'results_feed_cx', 'uci_team_ranking']) }, false),
    run({ dimensionFilter: gaScreenIn(['transfers', 'transfers_team']) }, false),
    run({
      dimensionFilter: {
        orGroup: {
          expressions: ['cx_race/', 'cx_tournament/'].map((value) => ({
            filter: { fieldName: 'unifiedScreenName', stringFilter: { matchType: 'BEGINS_WITH', value } },
          })),
        },
      },
    }, false),
  ]);

  const num = (row: GARow, index: number) => Number(row.metricValues[index]?.value ?? 0);
  const items: AppContentItem[] = [];

  // Nombre y etapa de cada jornada. Una carrera con alguna etapa rotulada es
  // una vuelta por etapas; el resto son pruebas de un día.
  const emptyName = (value: string | undefined) => !value || value === '(not set)';
  const days = new Map<string, { race: string; raceTop: number; stage: string; stageTop: number }>();
  for (const row of dayNames) {
    const id = row.dimensionValues?.[0]?.value ?? '';
    const race = row.dimensionValues?.[1]?.value;
    const stage = row.dimensionValues?.[2]?.value;
    const views = num(row, 0);
    const day = days.get(id) ?? { race: '', raceTop: -1, stage: '', stageTop: -1 };
    if (!emptyName(race) && views > day.raceTop) { day.raceTop = views; day.race = race!; }
    if (!emptyName(stage) && views > day.stageTop) { day.stageTop = views; day.stage = stage!; }
    days.set(id, day);
  }
  const stageRaces = new Set<string>();
  for (const day of days.values()) if (day.stage && day.race) stageRaces.add(day.race);

  for (const row of dayTotals) {
    const day = days.get(row.dimensionValues?.[0]?.value ?? '');
    if (!day || !stageRaces.has(day.race)) continue; // las pruebas de un día salen en raceTotals
    items.push({ kind: 'stage', name: `${day.race} · ${day.stage || 'Jornada'}`, views: num(row, 0), users: num(row, 1) });
  }
  for (const row of raceTotals) {
    const race = row.dimensionValues?.[0]?.value ?? '';
    if (!stageRaces.has(race)) items.push({ kind: 'race', name: race, views: num(row, 0), users: num(row, 1) });
  }
  for (const row of raceInfo) {
    const race = row.dimensionValues?.[0]?.value ?? '';
    if (stageRaces.has(race)) items.push({ kind: 'race_info', name: race, views: num(row, 0), users: num(row, 1) });
  }

  // Ciclocross: se agrupa por identificador, porque el nombre del torneo llega
  // localizado y un mismo torneo aparecería dos veces (castellano e inglés).
  const byId = (rows: GARow[], kind: 'cx_race' | 'cx_tournament') => {
    const groups = new Map<string, { name: string; top: number; views: number; users: number }>();
    for (const row of rows) {
      const id = row.dimensionValues?.[0]?.value ?? '';
      const views = num(row, 0);
      const group = groups.get(id) ?? { name: '', top: -1, views: 0, users: 0 };
      group.views += views;
      group.users += num(row, 1);
      if (views > group.top) { group.top = views; group.name = row.dimensionValues?.[1]?.value ?? ''; }
      groups.set(id, group);
    }
    for (const group of groups.values()) {
      items.push({ kind, name: group.name, views: group.views, users: group.users });
    }
  };
  byId(cxRaces, 'cx_race');
  byId(cxTournaments, 'cx_tournament');

  const tabs: [string, GARow[]][] = [['Ciclocross', cyclocross], ['Resultados', results], ['Fichajes', transfers]];
  for (const [name, rows] of tabs) {
    if (rows[0]) items.push({ kind: 'tab', name, views: num(rows[0], 0), users: num(rows[0], 1) });
  }
  if (unnamed[0]) {
    items.push({
      kind: 'cx_unnamed',
      name: 'Fichas y torneos de ciclocross sin nombre (apps anteriores a la 5.1.1)',
      views: num(unnamed[0], 0),
      users: num(unnamed[0], 1),
    });
  }

  return items
    .filter((item) => item.views > 0 && item.name)
    .sort((a, b) => b.views - a.views)
    .slice(0, 50);
}

// ── Main handler ─────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Este único endpoint público devuelve solo tres agregados redondeados para
  // la web de portfolio (danisanchez.dev). El resto de informes sigue
  // protegido por sesión.
  const isPortfolioStats = req.method === 'GET'
    && new URL(req.url).searchParams.get('report') === 'portfolio_stats';

  if (!isPortfolioStats && req.method !== 'POST') {
    return jsonRes({ error: 'Método no soportado' }, 405);
  }

  // Auth check: todos los informes salvo portfolio_stats.
  if (!isPortfolioStats) {
    const authStatus = await verifyAuth(req);
    if (authStatus === 401) return jsonRes({ error: 'No autorizado' }, 401);
    if (authStatus === 403) return jsonRes({ error: 'La operación requiere permisos de administración' }, 403);
  }

  const GA_PROPERTY_ID           = Deno.env.get('GA_PROPERTY_ID');
  const GA_APP_PROPERTY_ID       = Deno.env.get('GA_APP_PROPERTY_ID');
  const GA_SERVICE_ACCOUNT_EMAIL = Deno.env.get('GA_SERVICE_ACCOUNT_EMAIL');
  const GA_PRIVATE_KEY           = Deno.env.get('GA_PRIVATE_KEY');

  if (!GA_PROPERTY_ID || !GA_SERVICE_ACCOUNT_EMAIL || !GA_PRIVATE_KEY || (isPortfolioStats && !GA_APP_PROPERTY_ID)) {
    return jsonRes({ error: 'Variables de entorno de Google Analytics no configuradas' }, 500);
  }

  if (isPortfolioStats) {
    // Debe coincidir con el filtro "Desde inicio web" del panel de métricas.
    const startDate = '2026-04-06';
    const endDate = 'today';
    // Redondeo SIEMPRE a la baja: la web muestra las cifras con sufijo "+",
    // así que redondear al múltiplo más cercano (Math.round) podía publicar
    // más de lo real — 349.408 vistas se anunciaban como "360.000+".
    const floorTo = (value: number, step: number) => Math.floor(value / step) * step;

    try {
      const accessToken = await getGoogleAccessToken(GA_SERVICE_ACCOUNT_EMAIL, GA_PRIVATE_KEY);
      const fetchPublicReport = async (propertyId: string, report: ReportType): Promise<GAReport> => {
        const res = await fetch(
          `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(buildReportBody(report, { startDate, endDate })),
          },
        );
        if (!res.ok) throw new Error(`GA API error ${res.status}`);
        return res.json();
      };

      // Dos llamadas bastan: 'overview' da los totales de la web y 'platforms'
      // los de las apps ya desglosados por plataforma, así que de ahí salen
      // tanto el total móvil como la cifra de iOS/Android por separado.
      // La cifra debe cuadrar con el panel de métricas: si difiere, lo primero
      // que hay que comparar es el rango de fechas de ambos (ver `startDate`
      // arriba), no el cálculo — un día de desfase ya movía el total en unas
      // 10.600 páginas vistas.
      const [webOverview, appPlatforms] = await Promise.all([
        fetchPublicReport(GA_PROPERTY_ID, 'overview'),
        fetchPublicReport(GA_APP_PROPERTY_ID, 'platforms'),
      ]);

      // Orden de métricas en 'overview': 0 activeUsers · 2 screenPageViews.
      const webMetrics = webOverview.rows?.[0]?.metricValues ?? [];
      const webUsers = Number(webMetrics[0]?.value ?? 0);
      const webPageViews = Number(webMetrics[2]?.value ?? 0);

      // En 'platforms': 0 activeUsers · 2 screenPageViews, por plataforma.
      const appRows = (appPlatforms.rows ?? [])
        .filter((row) => ['IOS', 'ANDROID'].includes((row.dimensionValues?.[0]?.value ?? '').toUpperCase()));
      // Usuarios activos en las apps nativas (no descargas de la store).
      const appUsers = appRows.reduce((total, row) => total + Number(row.metricValues[0]?.value ?? 0), 0);
      const appPageViews = appRows.reduce((total, row) => total + Number(row.metricValues[2]?.value ?? 0), 0);

      const totalUsers = webUsers + appUsers;
      const totalPageViews = webPageViews + appPageViews;

      return jsonRes(
        {
          users: floorTo(totalUsers, 1000),
          pageViews: floorTo(totalPageViews, 10000),
          appDownloads: floorTo(appUsers, 100),
        },
        200,
        { 'Cache-Control': 'public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400' },
      );
    } catch (err) {
      return jsonRes({ error: `Error interno: ${(err as Error).message}` }, 500);
    }
  }

  let body: { report: ReportType; startDate?: string; endDate?: string };
  try {
    body = await req.json();
  } catch {
    return jsonRes({ error: 'JSON inválido' }, 400);
  }

  const reportType = body.report;
  if (!reportType) {
    return jsonRes({ error: 'Falta el campo "report"' }, 400);
  }

  // IDs de propiedades a consultar.
  //   top_screens, top_races, top_stages, app_content: solo la propiedad de apps
  //                                        (usan dimensiones específicas de
  //                                        eventos móviles).
  //   resto:                              ambas propiedades, fusionando resultados.
  let propertyIds: string[];
  if (['top_screens', 'top_races', 'top_stages', 'app_content'].includes(reportType)) {
    if (!GA_APP_PROPERTY_ID) {
      return jsonRes({ ok: true, report: reportType, data: { rows: [], rowCount: 0 } }, 200);
    }
    propertyIds = [GA_APP_PROPERTY_ID];
  } else {
    propertyIds = [GA_PROPERTY_ID];
    if (GA_APP_PROPERTY_ID && GA_APP_PROPERTY_ID !== GA_PROPERTY_ID) {
      propertyIds.push(GA_APP_PROPERTY_ID);
    }
  }

  // Default: last 30 days
  const startDate = body.startDate || '30daysAgo';
  const endDate   = body.endDate   || 'today';

  // Contenidos de las apps: varias consultas agregadas en una respuesta ya
  // clasificada (ver buildAppContent).
  if (reportType === 'app_content') {
    try {
      const accessToken = await getGoogleAccessToken(GA_SERVICE_ACCOUNT_EMAIL, GA_PRIVATE_KEY);
      const items = await buildAppContent(accessToken, propertyIds[0], { startDate, endDate });
      return jsonRes({ ok: true, report: reportType, data: { items } }, 200);
    } catch (err) {
      return jsonRes({ error: `Error interno: ${(err as Error).message}` }, 500);
    }
  }

  try {
    const accessToken = await getGoogleAccessToken(GA_SERVICE_ACCOUNT_EMAIL, GA_PRIVATE_KEY);

    const reportBody = buildReportBody(reportType, { startDate, endDate });
    const primaryPropertyId = propertyIds[0];

    // Reportes que dependen de dimensiones personalizadas (`customEvent:*`).
    // Si la dimensión aún no está registrada en GA4 Admin → Custom Definitions,
    // la API devuelve 400 INVALID_ARGUMENT. En ese caso degradamos a "sin datos"
    // en lugar de tumbar la petición.
    const usesCustomDimensions = reportType === 'top_races' || reportType === 'top_stages';

    const fetchReport = async (propId: string): Promise<GAReport | null> => {
      const res = await fetch(
        `https://analyticsdata.googleapis.com/v1beta/properties/${propId}:runReport`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify(reportBody),
        },
      );
      if (!res.ok) {
        const errText = await res.text();
        // Si es la propiedad secundaria, no romper la petición entera.
        if (propId !== primaryPropertyId) {
          console.warn(`[ga-analytics] propiedad ${propId} falló (${res.status}), usando solo la principal: ${errText.slice(0, 200)}`);
          return null;
        }
        // Custom dimensions sin registrar en GA4 → devolver reporte vacío.
        if (usesCustomDimensions && res.status === 400 && /not a valid dimension|INVALID_ARGUMENT/i.test(errText)) {
          console.warn(`[ga-analytics] ${reportType}: dimensiones custom no registradas en GA4 (property ${propId}). Devolviendo vacío.`);
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`GA API error ${res.status} (property ${propId}): ${errText.slice(0, 300)}`);
      }
      return res.json();
    };

    const results = await Promise.all(propertyIds.map(fetchReport));
    const [primary, secondary] = results;
    if (!primary) throw new Error('La propiedad principal no devolvió datos');
    const gaData = secondary ? mergeGAReports(primary, secondary) : primary;

    // El merge puede superar el limit (cada propiedad devuelve N filas con
    // fuentes distintas). Recortamos el resultado final al límite configurado.
    const POST_MERGE_LIMITS: Partial<Record<ReportType, number>> = {
      top_pages:       15,
      top_screens:     20,
      traffic_sources: 10,
      top_countries:   10,
      top_races:       15,
      top_stages:      15,
    };
    const rowLimit = POST_MERGE_LIMITS[reportType];
    if (rowLimit && gaData.rows && gaData.rows.length > rowLimit) {
      gaData.rows = gaData.rows.slice(0, rowLimit);
      gaData.rowCount = rowLimit;
    }

    return jsonRes({ ok: true, report: reportType, data: gaData }, 200);
  } catch (err) {
    return jsonRes({ error: `Error interno: ${(err as Error).message}` }, 500);
  }
});
