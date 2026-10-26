// Lógica del vigilante de Pages (scripts/pages-refresh/pages-refresh.mjs), sin
// red ni base de datos.
//
// Una página publicada queda distinta de la que pinta el navegador cuando
// cambia un dato entre builds. Cada caso tiene su criterio de cobertura:
//
// - Páginas: jornada publicada sin /jornada/<slug>/, o página de inscritos
//   cuyo <title> o aviso de lista provisional no coincide con
//   startlistProvisional. Criterio: la propia página publicada. Solo las
//   regenera un build completo o un incremental con una jornada de la
//   carrera (`stage_slugs`), que también rehace el <head>.
// - Refresco: orden de salida, documentos y datos del perfil de una jornada o
//   lista retirada. Todos los builds pintan esos prerender con datos
//   vigentes: cubre cualquier build creado después del cambio. Dispatch
//   `refresh`.
// - Resultados de carreras cerradas (firma de sus clasificaciones, como la
//   caché del prerender). Un push sin volcado los escribe desde la caché:
//   cubren solo un refresco o un build completo (cron o dispatch sin inputs).
//
// Un cambio que aparece en la instantánea por primera vez (lista, jornada o
// carrera cerrada nuevas) no tenía contenido generado: no cuenta.

// Espera desde el último cambio observado: agrupa lotes en un solo build.
export const QUIET_MS = 2 * 60_000;
// Dispatch por caso antes de abandonarlo al build diario de las 05:00 UTC.
export const MAX_DISPATCHES = 3;
// Slugs por incremental (límite de build_generated.py).
export const MAX_STAGE_SLUGS = 30;
export const STATE_VERSION = 2;

const REFRESH_RUN_NAME = 'prerender-refresh';
const FULL_RUN_NAME = 'Construir y desplegar el sitio';

/** Estado vacío del archivo de estado. */
export function emptyState() {
  return {
    version: STATE_VERSION, seeded: false,
    snapshot: { inscritos: {}, orden: {}, perfiles: {}, resultados: {}, jornadas: [] },
    pages: {}, refresh: null, results: null,
  };
}

const changedKeys = (previous, current) => Object.keys(previous)
  .filter(key => Object.hasOwn(current, key) && current[key] !== previous[key]);

/**
 * Cambios entre dos instantáneas. `inscritos`: { raceId: provisional } de las
 * carreras con lista; `orden`: { raceDayId: startOrderImportedAt };
 * `perfiles`: { raceDayId: firma de documentos y perfil }; `resultados`:
 * { raceId: firma } de las carreras cerradas; `jornadas`: slugs publicados.
 * Devuelve { inscritos: [raceId], jornadas: [slug], refresh: [motivo],
 * resultados: [raceId] }.
 */
export function snapshotChanges(previous, current) {
  const known = new Set(previous.jornadas);
  const refresh = [
    ...Object.keys(previous.inscritos).filter(id => !Object.hasOwn(current.inscritos, id)).map(id => `inscritos ${id}: sin lista`),
    ...[...new Set([...Object.keys(previous.orden), ...Object.keys(current.orden)])]
      .filter(id => previous.orden[id] !== current.orden[id]).map(id => `orden ${id}`),
    ...changedKeys(previous.perfiles, current.perfiles).map(id => `perfil ${id}`),
  ];
  return {
    inscritos: changedKeys(previous.inscritos, current.inscritos),
    jornadas: current.jornadas.filter(slug => !known.has(slug)),
    refresh,
    resultados: changedKeys(previous.resultados, current.resultados),
  };
}

const created = run => Date.parse(run.created_at);

/** Builds que vuelven a leer los resultados de las carreras cerradas. */
export const readsResults = run => run.display_title === REFRESH_RUN_NAME
  || (run.display_title === FULL_RUN_NAME && run.event !== 'push');

/**
 * Decisión sobre un caso pendiente ({ changedAt, dispatches }) con las
 * ejecuciones de build-site.yml en main y los builds que lo cubren (`covers`):
 * covered, wait, dispatch o abandon.
 */
export function coverDecision(pending, runs, now, covers = () => true) {
  const after = runs.filter(run => created(run) >= pending.changedAt && covers(run));
  if (after.some(run => run.status === 'completed' && run.conclusion === 'success')) return 'covered';
  if (after.some(run => run.status !== 'completed')) return 'wait';
  if (now - pending.changedAt < QUIET_MS) return 'wait';
  return pending.dispatches >= MAX_DISPATCHES ? 'abandon' : 'dispatch';
}

/**
 * Páginas pendientes ({ ruta: { slug, seenAt, dispatches } }, ya comprobadas
 * sin éxito) que entran en un incremental: { dispatch: [ruta], slugs,
 * abandon: [ruta] }, vacíos mientras llegan cambios del mismo lote o mientras
 * sigue en curso un build creado después del primero (un incremental lanzado
 * por un agente o el build completo). `slug`: jornada ES del incremental.
 */
export function pageDecision(pages, runs, now) {
  const paths = Object.keys(pages).sort();
  const seen = paths.map(path => pages[path].seenAt);
  const none = { dispatch: [], slugs: [], abandon: [] };
  if (!paths.length || now - Math.max(...seen) < QUIET_MS
      || runs.some(run => run.status !== 'completed' && created(run) >= Math.min(...seen))) return none;
  const abandon = paths.filter(path => pages[path].dispatches >= MAX_DISPATCHES);
  const dispatch = [];
  const slugs = new Set();
  for (const path of paths) {
    if (pages[path].dispatches >= MAX_DISPATCHES) continue;
    if (!slugs.has(pages[path].slug) && slugs.size >= MAX_STAGE_SLUGS) continue;
    slugs.add(pages[path].slug);
    dispatch.push(path);
  }
  return { dispatch, slugs: [...slugs].sort(), abandon };
}

/**
 * Estado provisional de una página de inscritos publicada: <title> del build
 * de OG y aviso del prerender. null si no hay contenido generado.
 */
export function publishedStartlist(html) {
  if (!html.includes('data-prerendered=')) return null;
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
  return {
    title: title.includes('lista provisional de inscritos'),
    body: html.includes('startlist-disclaimer--provisional'),
  };
}
