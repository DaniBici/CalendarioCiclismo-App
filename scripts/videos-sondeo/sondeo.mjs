#!/usr/bin/env node
// Sondeo de vídeos de carretera: resúmenes y últimos kilómetros en YouTube de
// fuentes de la lista blanca (canales.json), emparejados con las jornadas del
// universo (universo.sql). Solo lectura: no escribe en la base de datos.
//
//   node scripts/db/sql.mjs --read-only --file scripts/videos-sondeo/universo.sql > dias.json
//   node scripts/videos-sondeo/sondeo.mjs --dias dias.json --salida <carpeta> [--refuerzo] [--solo <texto>]
//
// Requiere yt-dlp (búsqueda). La verificación de cada vídeo lee la página de
// YouTube (estado, inserción, fecha y países) y oEmbed. Salida: manifiesto.json
// (todos los datos) e informe.md (resumen y huecos).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

function leerArgs(argv) {
  const a = { conc: 4, max: { summary: 2, last_km: 1 } };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--dias') a.dias = argv[++i];
    else if (k === '--salida') a.salida = argv[++i];
    else if (k === '--conc') a.conc = Number(argv[++i]);
    else if (k === '--solo') a.solo = argv[++i].toLowerCase();
    else if (k === '--refuerzo') a.refuerzo = true;
    else if (k === '--incluir-cubiertas') a.cubiertas = true;
    else if (k === '--no-verificar') a.noVerificar = true;
    else if (k === '--ajustes') a.ajustes = argv[++i];
    else if (k === '--otros') a.otros = true;
    else if (k === '--verificar') a.verificar = argv[++i].split(',');
    else if (k === '--permitir-no-insertables') a.noInsertables = true;
    else if (k === '--depurar') a.depurar = norm(argv[++i]);
    else if (k === '--max-resumen') a.max.summary = Number(argv[++i]);
    else if (k === '--max-ultimo-km') a.max.last_km = Number(argv[++i]);
  }
  if (!a.dias || !a.salida) {
    console.error('Uso: sondeo.mjs --dias dias.json --salida <carpeta> [--refuerzo] [--solo <texto>] [--incluir-cubiertas] [--no-verificar]');
    process.exit(2);
  }
  return a;
}

const norm = (s) => String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// races.nameEn de la Flecha Valona trae U+008F en lugar de «è» (dato corrupto): se repara aquí y se informa.
const fixNombre = (s) => String(s || '').replace(/\u008f/g, 'è').replace('Flche', 'Flèche');

// Ajustes manuales de la revisión (--ajustes ajustes.json): lista de {carrera, fecha, etapa?, aceptar?: [{id, motivo}], quitar?: [{id, motivo}]}.
// «aceptar» levanta solo los descartes por fecha, jornada gemela o descripción de un vídeo ya verificado (inserción, región y reproducción se siguen exigiendo);
// «quitar» descarta un vídeo con el motivo indicado. Cada ajuste queda en el manifiesto.
// ---------- Catálogo y alias ----------
const catalogo = JSON.parse(fs.readFileSync(path.join(AQUI, 'canales.json'), 'utf8'));
const canalPorId = new Map(catalogo.canales.map((c) => [c.id, c]));
// «otro»: canal fuera de la lista (--otros), siempre por detrás de los de referencia y sujeto a aprobación canal por canal.
const TIER = { ...catalogo.tiers, otro: -1 };
const excluidoPorId = new Map(catalogo.excluidos.map((c) => [c.id, c]));

const EXTRA = [
  ['auvergne', ['dauphine', 'criterium du dauphine', 'tour auvergne rhone alpes']],
  ['gent wevelgem', ['gent wevelgem', 'ghent wevelgem', 'gante wevelgem', 'in flanders fields']],
  ['in flanders fields', ['gent wevelgem', 'ghent wevelgem', 'gante wevelgem', 'in flanders fields']],
  ['brugge', ['brugge de panne', 'brugge depanne', 'bruges la panne', 'ronde van brugge', 'tour de brujas']],
  ['donostia', ['san sebastian', 'klasikoa', 'donostia', 'clasica san sebastian']],
  ['vuelta ciclista', ['la vuelta', 'vuelta a espana', 'vuelta ciclista a espana']],
  ['nieuwsblad', ['omloop', 'het nieuwsblad', 'nieuwsblad']],
  ['wallonne', ['fleche wallonne', 'flecha valona', 'waalse pijl']],
  ['itzulia', ['itzulia', 'vuelta al pais vasco', 'tour of the basque country', 'tour du pays basque', 'basque country']],
  ['tour de suisse', ['tour de suisse', 'vuelta a suiza', 'tour of switzerland']],
  ['tour de pologne', ['tour de pologne', 'tour of poland', 'vuelta a polonia']],
  ['renewi', ['renewi tour', 'benelux tour', 'tour of benelux']],
  ['tirreno', ['tirreno adriatico', 'tirreno']],
  ['milano sanremo', ['milano sanremo', 'milan san remo', 'milano-sanremo', 'sanremo']],
  ['sanremo', ['sanremo', 'san remo']],
  ['paris nice', ['paris nice', 'paris nizza', 'parijs nice', 'paris niza']],
  ['paris roubaix', ['paris roubaix', 'parijs roubaix', 'roubaix']],
  ['liege bastogne', ['liege bastogne liege', 'lieja bastona lieja', 'luik bastenaken luik']],
  ['eschborn', ['eschborn frankfurt', 'rund um den finanzplatz']],
  ['cyclassics', ['cyclassics hamburg', 'cyclassics', 'hamburg cyclassics']],
  ['bretagne', ['bretagne classic', 'ouest france plouay', 'plouay']],
  ['lorient', ['classic lorient', 'plouay', 'gp plouay', 'lorient']],
  ['quebec', ['gp quebec', 'grand prix cycliste de quebec', 'grand prix de quebec', 'quebec']],
  ['montreal', ['gp montreal', 'grand prix cycliste de montreal', 'grand prix de montreal', 'montreal']],
  ['lombardia', ['il lombardia', 'giro di lombardia', 'tour of lombardy', 'ronde van lombardije', 'tour de lombardie', 'lombardia']],
  ['guangxi', ['tour of guangxi', 'guangxi']],
  ['cadel evans', ['cadel evans great ocean road race', 'great ocean road race', 'geelong']],
  ['e3', ['e3 saxo classic', 'e3 harelbeke', 'e3 classic', 'e3 saxo bank classic']],
  ['dwars', ['dwars door vlaanderen', 'across flanders']],
  ['ronde van vlaanderen', ['ronde van vlaanderen', 'tour of flanders', 'tour des flandres']],
  ['volta a catalunya', ['volta a catalunya', 'volta ciclista a catalunya', 'vuelta a cataluna', 'tour of catalonia', 'volta catalunya']],
  ['romandie', ['tour de romandie', 'romandie']],
  ['binda', ['trofeo alfredo binda', 'binda']],
  ['chongming', ['tour of chongming island', 'chongming']],
  ['burgos', ['vuelta a burgos feminas', 'vuelta burgos feminas', 'burgos feminas']],
  ['la vuelta femenina', ['la vuelta femenina', 'vuelta femenina']],
  // ProSeries y .1 (2026-11-12)
  ['morvedre', ['classica camp de morvedre', 'clasica camp de morvedre', 'camp de morvedre']],
  ['castellon', ['gp castellon', 'gran premio castellon', 'ruta de la ceramica']],
  ['classica cv', ['classica comunitat valenciana', 'clasica comunitat valenciana', 'gran premi valencia', 'gran premio valencia']],
  ['volta a la comunitat valenciana', ['volta a la comunitat valenciana', 'volta comunitat valenciana', 'vuelta a la comunidad valenciana', 'vuelta comunidad valenciana', 'vcv']],
  ['vuelta cv', ['vuelta cv feminas', 'vcv feminas', 'vcv']],
  ['setmana valenciana', ['setmana ciclista valenciana', 'setmana ciclista', 'volta femenina valenciana', 'volta femenina comunitat valenciana']],
  ['murcia', ['vuelta a murcia', 'vuelta region de murcia', 'vuelta a la region de murcia', 'region de murcia']],
  ['gran camino', ['o gran camino', 'gran camino']],
  ['miguel indurain', ['gp miguel indurain', 'gran premio miguel indurain', 'miguel indurain']],
  ['andalucia', ['vuelta a andalucia', 'ruta del sol', 'vuelta andalucia']],
  ['getxo', ['circuito de getxo', 'getxo', 'getxoko klasika']],
  ['ordiziako', ['ordiziako klasika', 'clasica de ordizia', 'ordizia']],
  ['durango', ['durango durango', 'emakumeen saria']],
  ['besseges', ['etoile de besseges', 'tour du gard', 'estrella de besseges']],
  ['marseillaise', ['grand prix la marseillaise', 'gp la marseillaise', 'la marseillaise', 'gran premio la marsellesa']],
  ['kuurne', ['kuurne brussel kuurne', 'kuurne brussels kuurne', 'kuurne bruxelles kuurne']],
  ['denain', ['gp denain', 'grand prix de denain', 'grand prix denain', 'denain']],
  ['milano torino', ['milano torino', 'milan turin']],
  ['scheldeprijs', ['scheldeprijs']],
  ['samyn', ['samyn classic', 'le samyn', 'samyn']],
  ['veenendaal', ['veenendaal veenendaal', 'veenendaal classic', 'veenendaal']],
  ['brabantse', ['brabantse pijl', 'de brabantse pijl', 'flecha de brabante']],
  ['limburg', ['ronde van limburg', 'tour of limburg', 'tour de limbourg']],
  ['muur classic', ['muur classic', 'muurclassic', 'muur classic geraardsbergen']],
  ['heistse', ['heistse pijl', 'heylen vastgoed heistse pijl']],
  ['binche', ['binche chimay binche', 'binche chimay binche memorial frank vandenbroucke']],
  ['wynants', ['trofee maarten wynants', 'trofeo maarten wynants', 'maarten wynants']],
  ['argenta classic', ['argenta classic']],
  ['kampioenschap van vlaanderen', ['kampioenschap van vlaanderen', 'campeonato de flandes', 'koolskamp']],
  ['grand prix de wallonie', ['grand prix de wallonie', 'gp de wallonie', 'gp wallonie']],
  ['tour de wallonie', ['tour de wallonie', 'tour of wallonie', 'tour wallonie', 'tour of wallonia']],
  ['baloise belgium tour', ['baloise belgium tour', 'belgium tour']],
  ['baloise ladies tour', ['baloise ladies tour', 'baloise belgium tour women']],
  ['pays de la loire', ['region pays de la loire tour', 'pays de la loire tour', 'tour des pays de la loire']],
  ['adelie', ['adelie de vitre', 'classic adelie de vitre', 'route adelie de vitre']],
  ['fourmies', ['grand prix de fourmies', 'gp de fourmies', 'gp fourmies', 'la voix du nord', 'choralis fourmies']],
  ['tour de luxembourg', ['tour de luxembourg', 'skoda tour de luxembourg', 'tour de luxemburgo', 'tour of luxembourg', 'tour of luxemburg']],
  ['okolo slovenska', ['okolo slovenska', 'tour de slovaquie', 'tour of slovakia']],
  ['turkiye', ['tour of turkiye', 'tour of turkey', 'presidential tour of turkiye', 'presidential cycling tour of turkiye']],
  ['tour of denmark', ['tour of denmark', 'postnord danmark rundt', 'danmark rundt', 'tour de danemark']],
  ['tour of austria', ['tour of austria', 'osterreich rundfahrt', 'tour d autriche']],
  ['tour of taiwan', ['tour of taiwan', 'tour de taiwan']],
  ['langkawi', ['tour de langkawi', 'le tour de langkawi', 'langkawi']],
  ['japan cup', ['japan cup', 'utsunomiya japan cup', 'japan cup road race']],
  ['cyclothon', ['hong kong cyclothon', 'cyclothon']],
  ['hellas', ['tour of hellas', 'hellas tour']],
  ['bernocchi', ['coppa bernocchi', 'bernocchi']],
  ['agostoni', ['coppa agostoni', 'agostoni']],
  ['larciano', ['gp industria artigianato larciano', 'gp larciano', 'larciano', 'industria artigianato']],
  ['appennino', ['giro dell appennino', 'giro d appennino', 'appennino']],
  ['beiras', ['gp beiras e serra da estrela', 'volta as beiras', 'beiras e serra da estrela']],
  ['santos', ['santos womens one day race', 'santos women s one day race', 'santos tour down under womens classic', 'santos tour down under women s classic']],
  ['navarra', ['navarra womens elite classics', 'navarra women s elite classics', 'navarra elite classics', 'nwec']],
  ['tour of hungary', ['tour de hongrie', 'tour of hungary']],
  ['hongrie', ['tour de hongrie', 'tour of hungary']],
  ['baku', ['baku khankendi azerbaijan', 'baku khankendi', 'azerbaijan cycling race']],
  ['poitou', ['tour poitou charentes', 'tpc nouvelle aquitaine', 'tpc en nouvelle aquitaine']],
  ['eneco', ['eneco tour']],
  ['abruzzo', ['giro d abruzzo', 'il giro d abruzzo']],
  ['andratx mirador', ['trofeo port d andratx', 'port d andratx']],
  ['binissalem', ['trofeo binissalem andratx', 'binissalem andratx']],
  ['polynormande', ['polynormande']],
  ['aulne', ['boucles de l aulne', 'boucles de l aulne chateaulin']],
  ['laigueglia', ['trofeo laigueglia', 'treofo laigueglia', 'laigueglia trophy']],
  ['liberazione', ['gran premio della liberazione', 'gp liberazione', 'liberazione donne']],
  ['south aegean', ['visit south aegean gp', 'visit south aegean islands gp', 'south aegean islands gp']],
  ['dodecanese', ['region of dodecanese gp', 'region on dodecanese gp', 'dodecanese gp']],
];
// Pruebas solo femeninas cuyo título puede no llevar marca de género: se aceptan sin marca y se rechazan para jornadas masculinas.
const SOLO_MUJERES = ['lorient', 'binda', 'llucmajor', 'binissalem', 'marratxi', 'pionera', 'hageland', 'ronde de mouscron', 'borsele', 'liberazione donne', 'schellebelle', 'wynants', 'schelkens', 'argenta classic', 'lucien van impe', 'kortrijk koerse', 'region stuttgart', 'gatineau', 'oro in euro', 'vuelta cv', 'setmana valenciana', 'navarra', 'omloop der kempen', 'dwars door de westhoek', 'egmont race', 'picto', 'perigord', 'kreiz breizh elites feminin', 'elsy jacobs'];
// Marca explícita de género masculino en el título (sin ella, un vídeo de una prueba con gemela femenina cercana es ambiguo).
const MASCULINO = /\b(men|mens|male|hommes?|masculin[oa]?|uomini|heren|herren|messieurs)\b/;
const GENERO = /\b(women|womens|woman|femmes?|femenin[oa]s?|feminas?|feminin[oa]?|femminil[ei]|donne|dames|vrouwen|frauen|ladies|wwt|damen|lady)\b/;

function aliasesDe(d) {
  const crudos = [d.nameEn, d.name, d.originalName].filter(Boolean).map(fixNombre);
  const base = new Set();
  for (const c of crudos) {
    for (const parte of c.split(/[()]/)) {
      let n = norm(parte);
      n = n.replace(/\b(women|womens|femmes?|femenin[oa]s?|feminas?|elite|ladies)\b/g, ' ').replace(/\s+/g, ' ').trim();
      if (n.length >= 4) base.add(n);
    }
  }
  const todo = new Set(base);
  const juntos = [...base].join(' | ');
  for (const [clave, extras] of EXTRA) if (juntos.includes(clave)) extras.forEach((e) => todo.add(e));
  return [...todo];
}

// ---------- Búsqueda ----------
const FMT = '%(id)s\t%(channel)s\t%(channel_id)s\t%(channel_is_verified)s\t%(duration)s\t%(view_count)s\t%(title)s';
function buscarYT(q) {
  return new Promise((ok) => {
    const p = spawn('yt-dlp', ['--flat-playlist', '--print', FMT, `ytsearch30:${q}`]);
    let buf = '';
    p.stdout.on('data', (x) => (buf += x));
    p.stderr.on('data', () => {});
    p.on('error', () => ok([]));
    p.on('close', () => {
      ok(buf.split('\n').filter(Boolean).map((l) => {
        const [id, channel, channelId, verified, duration, views, ...t] = l.split('\t');
        return { id, channel, channelId, verified: verified === 'True', duration: Number(duration) || null, views: Number(views) || null, title: t.join('\t') };
      }));
    });
  });
}

function consultasDe(d, refuerzo) {
  const E = fixNombre(d.nameEn || d.name);
  const unDia = Number(d.ridingDays) === 1;
  const n = Number(d.stageNumber);
  const etapa = unDia ? '' : n === 0 ? ' prologue' : ` stage ${n}`;
  const etapaEs = unDia ? '' : n === 0 ? ' prólogo' : ` etapa ${n}`;
  const q = [`${E} 2026${etapa} highlights`, `${E} 2026${etapa} last km`, `${E} 2026${etapaEs} resumen`];
  if (refuerzo) q.push(`${E} 2026${etapa} extended highlights`, `${E} 2026${etapa} last kilometres`, `TNT Sports Cycling ${E} 2026${etapa}`, `Eurosport España ${E} 2026${etapaEs}`);
  return q;
}

// ---------- Clasificación de títulos ----------
const RE_RECHAZO = /\b(interview|entrevista|interviu|rueda de prensa|press conference|conferencia|preview|presentacion|presentation|the route|el recorrido|parcours|percorso|podium|podio|onboard|on board|reaction|reaccion|behind the scenes|vlog|podcast|quiz|look back|throwback|retro|memorable|top \d+|rewind|trailer|teaser|route 20\d\d|awards?|ceremon\w*|ceremonia|cerimon\w*|aftermovie|after movie|promo|bande annonce|en vivo|directo|live|full replay|replay|carrera completa|pronostico|tertulia|debate|opinion|fantasy|prediction|predictions|cafe y ciclismo)\b/;
const RE_ULTIMO_KM = /\b(last\s*(\d+\s*)?(km|kms|kilomet\w*|k)|final\s*(\d+\s*)?(km|kms|kilomet\w*)|ultimos?\s*(\d+\s*)?(km|kms|kilomet\w*)|ultimi\s*(\d+\s*)?(km|kilomet\w*)|derniers?\s*(\d+\s*)?(km|kilomet\w*)|laatste\s*(\d+\s*)?(km|kilomet\w*)|letzte\w*\s*(\d+\s*)?(km|kilomet\w*)|last km|ultimo km)\b/;
const RE_FINISH = /\brace finish\b/;
const RE_RESUMEN = /\b(highlights?|highligts?|hl|summary|summaries|resum|cronica|resumen|resume|resumes|samenvatting|riassunto|sintesi|zusammenfassung|resumo|express)\b/;
const RE_RECAP = /\b(best of|best moments?|race highlights|highlights of the|edition|race recap|week \d|semana \d|season|temporada)\b/;

function clasificar(t, duracion, unDia) {
  if (RE_RECHAZO.test(t)) return null;
  if (RE_ULTIMO_KM.test(t) || (RE_FINISH.test(t) && !RE_RESUMEN.test(t))) return duracion && (duracion < 25 || duracion > 1200) ? null : 'last_km';
  // «Race highlights» es el resumen de una prueba de un día; en una vuelta es la recopilación de toda la carrera.
  if (unDia) { if (/\b(best of|best moments?|week \d|semana \d|season|temporada)\b/.test(t)) return null; }
  else if (RE_RECAP.test(t) && !/stage|etapa|etape|tappa|etappe|prolog/.test(t)) return 'recap';
  if (RE_RESUMEN.test(t)) return duracion && (duracion < 90 || duracion > 2400) ? null : 'summary';
  return null;
}
function generoPorDescripcion(txt) {
  const t = norm(txt);
  const f = GENERO.test(t), m = MASCULINO.test(t);
  return f && !m ? 'f' : m && !f ? 'm' : null;
}
function etapaDe(t) {
  if (/\b(prologue|prologo|prolog|proloog)\b/.test(t)) return 0;
  const m = t.match(/\b(?:stage|etapa|etape|tappa|etappe)\s*(\d{1,2})\b/) || t.match(/\b(\d{1,2})\s*(?:a|ere|re|e|eme|st|nd|rd|th)?\s*(?:etapa|etape|tappa|etappe|stage)\b/);
  return m ? Number(m[1]) : null;
}
function idiomaDe(titulo, delCanal) {
  if (delCanal && delCanal !== 'multi') return delCanal;
  const t = ` ${norm(titulo)} `;
  const puntos = {
    es: [' resumen ', ' etapa ', ' ultimos ', ' el ', ' la ', ' los ', ' del ', ' espanol ', ' hace ', ' gana '],
    en: [' stage ', ' last ', ' the ', ' of ', ' wins ', ' win ', ' final ', ' race ', ' events ', ' international ', ' cycling '],
    it: [' tappa ', ' ultimi ', ' gara ', ' vince ', ' il ', ' che ', ' di ', ' da ', ' prima ', ' uomini ', ' donne ', ' della ', ' una ', ' nella ', ' prestazione ', ' classica '],
    fr: [' etape ', ' derniers ', ' resume ', ' le ', ' les ', ' des ', ' victoire '],
    de: [' etappe ', ' letzte ', ' zusammenfassung ', ' der ', ' die ', ' das '],
    nl: [' etappe ', ' laatste ', ' samenvatting ', ' van ', ' het ', ' een ', ' wint ', ' voor ', ' de ', ' winnaar '],
  };
  let mejor = 'en', max = 0;
  for (const [l, ps] of Object.entries(puntos)) {
    const n = ps.filter((p) => t.includes(p)).length;
    if (n > max) { max = n; mejor = l; }
  }
  // Sin palabras reconocibles: un título con letras solo del alfabeto latino (los emoji no cuentan) se toma por inglés; otro alfabeto queda sin idioma.
  return max ? mejor : (/^\p{Script=Latin}*$/u.test(String(titulo).replace(/[^\p{L}]/gu, '')) ? 'en' : '?');
}

// ---------- Verificación de la página ----------
let bloqueado = false; // Google responde con /sorry/ ante exceso de peticiones: no se insiste ni se esquiva
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
async function leerPagina(id) {
  const out = { id };
  try {
    const r = await fetch(`https://www.youtube.com/watch?v=${id}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'en', Cookie: 'SOCS=CAI; CONSENT=YES+1' }, redirect: 'manual', signal: AbortSignal.timeout(30000) });
    if (r.status >= 300 && r.status < 400) {
      out.bloqueo = /\/sorry\//.test(r.headers.get('location') || '') ? 'sorry' : `redirect ${r.status}`;
      return out;
    }
    const h = await r.text();
    const pr = h.match(/"playabilityStatus":\{"status":"([A-Z_]+)"/);
    out.playability = pr ? pr[1] : null;
    out.playableInEmbed = /"playableInEmbed":true/.test(h) ? true : /"playableInEmbed":false/.test(h) ? false : null;
    const pc = h.match(/"availableCountries":\[([^\]]*)\]/);
    out.paises = pc ? pc[1].replace(/"/g, '').split(',').filter(Boolean) : null;
    out.publicado = (h.match(/"publishDate":"([^"]+)"/) || h.match(/"uploadDate":"([^"]+)"/) || [])[1] || null;
    out.segundos = Number((h.match(/"lengthSeconds":"(\d+)"/) || [])[1]) || null;
    out.canalId = (h.match(/"channelId":"(UC[\w-]{22})"/) || [])[1] || null;
    out.directo = /"isLiveContent":true/.test(h);
    out.descripcion = ((h.match(/"shortDescription":"((?:[^"\\]|\\.){0,400})/) || [])[1] || '').replace(/\\n/g, ' ').replace(/\\u0026/g, '&').slice(0, 300);
    out.privado = /"isPrivate":true/.test(h);
    if (!out.playability) out.bloqueo = 'sin datos';
  } catch (e) {
    out.error = e.message;
  }
  try {
    const o = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`, { signal: AbortSignal.timeout(20000) });
    out.oembed = o.status;
  } catch { out.oembed = null; }
  return out;
}
// Lecturas secuenciales con pausa; se detiene ante el primer bloqueo y no guarda los fallos.
async function leerPaginas(ids, ruta, cache) {
  let n = 0;
  for (const id of ids) {
    if (bloqueado) break;
    const p = await leerPagina(id);
    if (p.bloqueo === 'sorry') { bloqueado = true; console.error('  Google devuelve /sorry/: se detiene la verificación (sin esquivar el bloqueo).'); break; }
    if (p.playability) cache[id] = p;
    if (++n % 20 === 0) { fs.writeFileSync(ruta, JSON.stringify(cache)); console.error(`  ${n}/${ids.length}`); }
    await dormir(2500 + Math.random() * 2000); // ~17 lecturas por minuto
  }
  fs.writeFileSync(ruta, JSON.stringify(cache));
}

const EUROPA = ['ES', 'FR', 'IT', 'DE', 'GB', 'NL', 'BE', 'PT', 'AT', 'CH', 'IE', 'SE', 'DK', 'NO', 'FI', 'PL', 'CZ', 'GR', 'HU', 'RO'];
function region(paises) {
  if (!paises) return { grupo: 'ALL', mundial: true, europa: true, es: true, faltan: [] };
  const s = new Set(paises);
  const mundial = s.size >= 230;
  const faltan = EUROPA.filter((c) => !s.has(c));
  // Europa: España y a lo sumo 2 de los 20 países de referencia ausentes (p. ej. Bélgica); los ausentes quedan en el manifiesto.
  const europa = s.has('ES') && faltan.length <= 2;
  const es = s.has('ES');
  let grupo = 'REVISAR';
  if (mundial) grupo = 'ALL';
  else if (europa) grupo = 'EUROPA';
  else if (s.size <= 3 && es) grupo = 'ES';
  return { grupo, mundial, europa, es, n: s.size, faltan };
}

function sumarDias(clave, n) {
  const d = new Date(`${clave}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

// ---------- Principal ----------
const A = leerArgs(process.argv.slice(2));
fs.mkdirSync(A.salida, { recursive: true });
const rutaBusq = path.join(A.salida, 'busquedas.json');
const rutaPag = path.join(A.salida, 'paginas.json');
const cacheBusq = fs.existsSync(rutaBusq) ? JSON.parse(fs.readFileSync(rutaBusq, 'utf8')) : {};
const cachePag = fs.existsSync(rutaPag) ? JSON.parse(fs.readFileSync(rutaPag, 'utf8')) : {};
for (const k of Object.keys(cachePag)) if (!cachePag[k].playability) delete cachePag[k];

if (A.noVerificar) bloqueado = true;
let dias = JSON.parse(fs.readFileSync(A.dias, 'utf8'));
const AJUSTES = A.ajustes ? JSON.parse(fs.readFileSync(A.ajustes, 'utf8')) : [];
// Jornadas gemelas: de género opuesto, con algún alias común y a menos de 12 días. Sirven para descartar
// vídeos sin marca de género cuya fecha de publicación cae más cerca de la gemela (p. ej. Clásica de Almería M y F).
{
  const todas = dias.map((d) => ({ d, al: aliasesDe(d) }));
  for (const x of todas) {
    const unDiaX = Number(x.d.ridingDays) === 1;
    x.d.gemelas = todas.filter((y) => y.d.gender !== x.d.gender && (Number(y.d.ridingDays) === 1) === unDiaX && (unDiaX || Number(y.d.stageNumber) === Number(x.d.stageNumber)) && y.al.some((a) => x.al.includes(a)) && Math.abs(Date.parse(y.d.dateKey) - Date.parse(x.d.dateKey)) <= 12 * 86400000).map((y) => y.d.dateKey);
  }
}
// Una jornada con emisión de YouTube se da por cubierta solo si esa emisión se
// reproduce, se inserta y está disponible en España y en Europa (geobloqueo).
const idDeUrl = (u) => (String(u).match(/(?:v=|youtu\.be\/|\/live\/)([\w-]{11})/) || [])[1];
const idsCub = [...new Set(dias.filter((d) => d.ytFixed).flatMap((d) => (d.ytUrls || []).filter((b) => ['ALL', 'EUROPA', 'ES'].includes(b.country)).map((b) => idDeUrl(b.url))).filter(Boolean))].filter((id) => !(id in cachePag));
console.error(`emisiones de YouTube a comprobar por geobloqueo: ${idsCub.length}`);
await leerPaginas(idsCub, rutaPag, cachePag);
const descubiertasPorGeo = [];
for (const d of dias.filter((x) => x.ytFixed)) {
  d.ytVerificada = (d.ytUrls || []).filter((b) => ['ALL', 'EUROPA', 'ES'].includes(b.country)).map((b) => {
    const p = cachePag[idDeUrl(b.url)];
    if (!p) return { url: b.url, sinVerificar: true, ok: true };
    const r = region(p.paises);
    return { url: b.url, playability: p.playability, oembed: p.oembed, grupoPaises: r.grupo, paises: r.n, faltan: r.faltan, ok: p.playability === 'OK' && [200, 401].includes(p.oembed) && r.es && (r.europa || r.mundial) };
  });
  if (!d.ytVerificada.some((v) => v.ok)) { d.ytFixed = false; descubiertasPorGeo.push(d); }
}
if (descubiertasPorGeo.length) console.error(`jornadas con emisión de YouTube no visible en Europa, incluidas en el sondeo: ${descubiertasPorGeo.length}`);
const cubiertas = dias.filter((d) => d.ytFixed);
if (!A.cubiertas) dias = dias.filter((d) => !d.ytFixed);
if (A.solo) dias = dias.filter((d) => norm(`${d.name} ${d.nameEn}`).includes(norm(A.solo)));
console.error(`jornadas: ${dias.length} (cubiertas por emisión de YouTube: ${cubiertas.length})`);

// 1. Búsquedas
const consultas = [...new Set(dias.flatMap((d) => consultasDe(d, A.refuerzo)))].filter((q) => !(q in cacheBusq));
console.error(`búsquedas nuevas: ${consultas.length}`);
let hechas = 0;
await pool(consultas, A.conc, async (q) => {
  let it = await buscarYT(q);
  if (!it.length) it = await buscarYT(q);
  cacheBusq[q] = it;
  if (++hechas % 25 === 0) { fs.writeFileSync(rutaBusq, JSON.stringify(cacheBusq)); console.error(`  ${hechas}/${consultas.length}`); }
});
fs.writeFileSync(rutaBusq, JSON.stringify(cacheBusq));

// 2. Emparejamiento por título
const porDia = new Map();
// Subidas enumeradas de los canales de organizador (canales-listado.mjs) y búsquedas dentro de los canales de WBD y de los equipos WorldTour (canales-busqueda.mjs): se emparejan con todas las jornadas.
const clavesCanal = Object.keys(cacheBusq).filter((k) => k.startsWith('canal:') || k.startsWith('cb:') || (A.otros && k.startsWith('amp:')));
const ajenos = new Map(); // canales fuera de la lista que aportan títulos válidos
const recaps = new Map();
for (const d of dias) {
  const al = aliasesDe(d);
  const mujer = d.gender === 'female';
  const unDia = Number(d.ridingDays) === 1;
  const n = Number(d.stageNumber);
  const vistos = new Map();
  for (const q of [...consultasDe(d, A.refuerzo), ...clavesCanal]) {
    for (const it of cacheBusq[q] || []) {
      if (!it.id || vistos.has(it.id)) continue;
      const t = norm(it.title);
      const padded = ` ${t} `;
      const dbg = A.depurar && t.includes(A.depurar) ? (m) => console.error(`  [depurar] ${d.name} ${d.dateKey}: ${m} :: ${it.title.slice(0, 90)}`) : () => {};
      if (!al.some((a) => padded.includes(` ${a} `))) { dbg(`alias no coincide (${al.join('|')})`); continue; }
      // Pruebas solo femeninas (Classic Lorient, Binda): su título puede no llevar marca de género.
      const soloMujeres = mujer && SOLO_MUJERES.some((k) => al.some((a) => a.includes(k)));
      if (!mujer && SOLO_MUJERES.some((k) => t.includes(k))) { dbg('título de prueba solo femenina'); continue; }
      // Prueba femenina sin marca de género en el título y con una gemela masculina cercana: se decide después por la descripción y la fecha.
      let sinMarca = false;
      if (!soloMujeres && GENERO.test(t) !== mujer) {
        if (mujer && !MASCULINO.test(t) && (d.gemelas || []).length) sinMarca = true;
        else { dbg('género'); continue; }
      }
      if (soloMujeres && !mujer) continue;
      if (soloMujeres && MASCULINO.test(t)) { dbg('prueba solo femenina con marca masculina'); continue; }
      const anios = (t.match(/\b20\d\d\b/g) || []).map(Number);
      if (anios.length && !anios.includes(2026)) { dbg('año'); continue; }
      const canal = canalPorId.get(it.channelId) || (A.otros && it.channelId && it.channelId !== 'NA' ? { tier: 'otro', nombre: it.channel, idioma: 'multi', excluidoMotivo: excluidoPorId.get(it.channelId)?.motivo || null, seguidoresVerificado: it.verified } : null);
      if (excluidoPorId.get(it.channelId)?.definitivo) { dbg('canal rechazado definitivamente'); continue; }
      let kind = clasificar(t, it.duration, unDia);
      let inferido = kind === 'last_km' && RE_FINISH.test(t) && !RE_ULTIMO_KM.test(t);
      const entrevista = /🎙|\b(winner|ganador|interview|entrevista)\b/i.test(it.title);
      if (!kind && canal?.tier === 'organizador' && it.duration >= 200 && it.duration <= 1500 && !entrevista && !RE_RECHAZO.test(t) && (unDia || !RE_RECAP.test(t))) { kind = 'summary'; inferido = true; }
      if (inferido && entrevista) continue;
      if (!kind) continue;
      // Canales fuera de la lista: duraciones más estrictas (los vídeos largos suelen ser coberturas completas).
      if (canal?.tier === 'otro' && it.duration && ((kind === 'summary' && (it.duration < 120 || it.duration > 1500)) || (kind === 'last_km' && (it.duration < 30 || it.duration > 600)))) { dbg('duración fuera de rango para otro canal'); continue; }
      // Rango de etapas («Stage 1-8»): resumen de toda la carrera, no de una jornada.
      if (/\b(stages?|etapas?|etapes?|etappes?|tappe)\s*\d{1,2}\s*[-–—]\s*\d{1,2}\b/i.test(it.title) && kind !== 'last_km') kind = 'recap';
      const e = etapaDe(t);
      if (!unDia && kind !== 'recap' && e !== n) continue;
      // Una prueba con una sola jornada disputada puede llevar número de etapa si otras se cancelaron (Vuelta a Murcia).
      if (unDia && e !== null && e !== n) continue;
      if (kind === 'recap') {
        const k = d.raceId; if (!recaps.has(k)) recaps.set(k, new Map());
        if (canalPorId.has(it.channelId)) recaps.get(k).set(it.id, it);
        continue;
      }
      if (!canal) {
        const k = `${it.channelId}|${it.channel}`;
        ajenos.set(k, (ajenos.get(k) || 0) + 1);
        continue;
      }
      vistos.set(it.id, { ...it, kind, inferido, tier: canal.tier, canalNombre: canal.nombre || it.channel, excluidoMotivo: canal.excluidoMotivo || null, insignia: Boolean(canal.seguidoresVerificado), pequeno: canal.pequeno === true, sinMarcaGenero: sinMarca || (!mujer && !MASCULINO.test(t)), idioma: idiomaDe(it.title, canal.idioma) });
    }
  }
  porDia.set(d.dayId, [...vistos.values()]);
}

// Evalúa un candidato contra la página verificada: devuelve los motivos de descarte (vacío = válido).
function evaluar(d, c) {
  const desde = sumarDias(d.dateKey, -1);
  const hasta = sumarDias(d.dateKey, 10);
  const p = cachePag[c.id] || {};
  const verificado = Boolean(cachePag[c.id]);
  const fecha = p.publicado ? p.publicado.slice(0, 10) : null;
  const r = region(p.paises);
  const motivos = [];
  if (!verificado) motivos.push(aVerificar.has(c.id) ? 'sin verificar' : 'fuera del tope de verificación');
  else if (p.playability !== 'OK') motivos.push(`reproducción ${p.playability}`);
  if (verificado) {
    if (p.oembed === 401) { if (!A.noInsertables) motivos.push('inserción desactivada (oEmbed 401)'); }
    else if (p.oembed !== 200) motivos.push(`oEmbed ${p.oembed}`);
    else if (p.playableInEmbed === false) { if (!A.noInsertables) motivos.push('no se puede insertar'); }
    if (p.directo) motivos.push('directo');
    if (!fecha) motivos.push('sin fecha'); else if (fecha < desde || fecha > hasta) motivos.push(`fecha ${fecha} fuera de ${desde}..${hasta}`);
    if (fecha && c.sinMarcaGenero && (d.gemelas || []).length) {
      // Sin marca de género en el título: la descripción de la página decide; si no basta, la fecha de publicación debe quedar estrictamente más cerca de esta jornada que de la gemela.
      const gd = generoPorDescripcion(p.descripcion);
      const propio = d.gender === 'female' ? 'f' : 'm';
      if (gd && gd !== propio) motivos.push('la descripción indica el otro género');
      else if (!gd && d.gemelas.some((g) => Math.abs(Date.parse(fecha) - Date.parse(g)) <= Math.abs(Date.parse(fecha) - Date.parse(d.dateKey)))) motivos.push('posible vídeo de la jornada gemela (sin marca de género)');
    }
    if (p.canalId && p.canalId !== c.channelId) motivos.push('canal distinto del de la búsqueda');
    if (!r.es) motivos.push('no disponible en España');
    else if (!r.europa && !r.mundial) motivos.push(`no cubre Europa (${r.n} países; faltan ${r.faltan.join(',')})`);
  }
  // Ajustes manuales
  let ajuste = null;
  for (const aj of AJUSTES) {
    if (!d.name.toLowerCase().includes(String(aj.carrera).toLowerCase()) || aj.fecha !== d.dateKey) continue;
    const ac = (aj.aceptar || []).find((x) => x.id === c.id);
    if (ac) { for (let i = motivos.length - 1; i >= 0; i--) if (/^fecha |^posible vídeo de la jornada gemela|^la descripción indica/.test(motivos[i])) motivos.splice(i, 1); ajuste = `aceptado: ${ac.motivo}`; }
    const qu = (aj.quitar || []).find((x) => x.id === c.id);
    if (qu) { motivos.push(`retirado en la revisión: ${qu.motivo}`); ajuste = `retirado: ${qu.motivo}`; }
  }
  return { p, verificado, fecha, r, motivos, ajuste };
}

// 3. Verificación (solo los candidatos con opciones de ser elegidos: hasta 5 por jornada y tipo)
const TOPE = 5;
const prioridad = (a, b) => (Number(a.inferido) - Number(b.inferido)) || (TIER[b.tier] - TIER[a.tier]);
const aVerificar = new Set();
// Fase A: canales de referencia (organizador, WBD, emisor, equipos).
for (const cands of porDia.values()) {
  for (const kind of ['summary', 'last_km']) {
    const deKind = cands.filter((c) => c.kind === kind && c.tier !== 'otro').sort(prioridad);
    deKind.slice(0, TOPE).forEach((c) => aVerificar.add(c.id));
    deKind.filter((c) => c.tier === 'equipos').slice(0, 2).forEach((c) => aVerificar.add(c.id)); // D4: el canal de los equipos, presente aunque su prioridad sea la más baja
  }
}
// --verificar: ids concretos que se leen aunque queden fuera del tope (revisión manual de un canal).
for (const id of A.verificar || []) aVerificar.add(id);
const ids = [...aVerificar].filter((id) => !(id in cachePag));
console.error(`páginas a verificar (referencia): ${ids.length} (en caché: ${aVerificar.size - ids.length})`);
await leerPaginas(ids, rutaPag, cachePag);
// Fase B: canales fuera de la lista (--otros), solo para los tipos de jornada que quedan sin cubrir por los de referencia.
if (A.otros) {
  const idioma = (c) => (c.idioma === 'es' ? 0 : c.idioma === 'en' ? 1 : 2);
  const prioridadOtro = (a, b) => (idioma(a) - idioma(b)) || ((b.views || 0) - (a.views || 0));
  const idsOtros = new Set();
  for (const d of dias) {
    const cands = porDia.get(d.dayId) || [];
    for (const kind of ['summary', 'last_km']) {
      const validos = new Set(cands.filter((c) => c.kind === kind && c.tier !== 'otro' && c.tier !== 'equipos' && evaluar(d, c).motivos.length === 0).map((c) => c.channelId));
      if (validos.size >= A.max[kind]) continue;
      cands.filter((c) => c.kind === kind && c.tier === 'otro').sort(prioridadOtro).slice(0, TOPE).forEach((c) => idsOtros.add(c.id));
    }
  }
  idsOtros.forEach((id) => aVerificar.add(id));
  const idsO = [...idsOtros].filter((id) => !(id in cachePag));
  console.error(`páginas a verificar (otros canales): ${idsO.length} (en caché: ${idsOtros.size - idsO.length})`);
  await leerPaginas(idsO, rutaPag, cachePag);
}
const sinVerificar = [...aVerificar].filter((id) => !(id in cachePag)).length;
if (sinVerificar) console.error(`sin verificar: ${sinVerificar} (relanzar el mismo comando cuando YouTube deje de bloquear)`);

// 4. Selección y manifiesto
// Un vídeo emparejado con jornadas de varias carreras (resumen conjunto) pierde frente a uno dedicado a una sola.
const carrerasPorVideo = new Map();
for (const d of dias) for (const c of porDia.get(d.dayId) || []) { if (!carrerasPorVideo.has(c.id)) carrerasPorVideo.set(c.id, new Set()); carrerasPorVideo.get(c.id).add(d.raceId); }
const prioridadIdioma = { es: 0, en: 1 };
const manifiesto = [];
for (const d of dias) {
  const cands = (porDia.get(d.dayId) || []).map((c) => {
    const { p, verificado, fecha, r, motivos, ajuste } = evaluar(d, c);
    return {
      ajuste,
      id: c.id, url: `https://www.youtube.com/watch?v=${c.id}`, kind: c.kind, inferido: c.inferido, excluidoMotivo: c.excluidoMotivo, insignia: c.insignia, multiCarrera: (carrerasPorVideo.get(c.id)?.size || 0) > 1, pequeno: c.pequeno, canal: c.canalNombre, canalId: c.channelId, tier: c.tier,
      titulo: c.title, idioma: c.idioma, segundos: p.segundos || c.duration, vistas: c.views, publicado: fecha,
      verificado, embebible: p.oembed === 200 && p.playableInEmbed !== false, grupoPaises: r.grupo, paisesN: r.n ?? null, paisesFaltantes: r.faltan || [],
      valido: motivos.length === 0, motivos,
    };
  });
  const sel = { summary: [], last_km: [] };
  const perdidas = { summary: 0, last_km: 0 };
  for (const kind of ['summary', 'last_km']) {
    const canales = new Set();
    let canalEquipos = null;
    // Primero los canales de referencia y después, si quedan huecos, los demás (--otros): cada clase aplica la regla de idioma por su cuenta.
    for (const clase of ['referencia', 'otro']) {
      let validos = cands.filter((c) => c.kind === kind && c.valido && (clase === 'otro') === (c.tier === 'otro'));
      // D2: castellano, después inglés; otro idioma solo si no hay ninguno de los dos.
      if (validos.some((c) => c.idioma === 'es' || c.idioma === 'en')) validos = validos.filter((c) => c.idioma === 'es' || c.idioma === 'en');
      validos.sort((a, b) => (Number(a.inferido) - Number(b.inferido)) || (TIER[b.tier] - TIER[a.tier]) || (Number(a.multiCarrera) - Number(b.multiCarrera)) || ((prioridadIdioma[a.idioma] ?? 9) - (prioridadIdioma[b.idioma] ?? 9)) || ((b.vistas || 0) - (a.vistas || 0)));
      for (const c of validos.filter((x) => x.tier !== 'equipos')) {
        if (sel[kind].length >= A.max[kind]) break;
        if (canales.has(c.canalId)) continue;
        canales.add(c.canalId); sel[kind].push(c.id);
      }
      if (clase === 'referencia') canalEquipos = validos.find((x) => x.tier === 'equipos') || null;
    }
    // D4: el canal de los equipos va aparte, con prioridad más baja: no quita espacio a los demás y se añade si es válido.
    if (canalEquipos && !canales.has(canalEquipos.canalId)) sel[kind].push(canalEquipos.id);
    // D3: vídeos descartados solo por no poder insertarse, cuando eran la única opción.
    if (!sel[kind].length) perdidas[kind] = cands.filter((c) => c.kind === kind && c.motivos.length === 1 && c.motivos[0].startsWith('inserción desactivada')).length;
  }
  const pendiente = cands.some((c) => c.motivos[0] === 'sin verificar');
  const estado = sel.summary.length && sel.last_km.length ? 'completo' : sel.summary.length || sel.last_km.length ? 'parcial' : pendiente ? 'pendiente' : 'vacio';
  manifiesto.push({ dayId: d.dayId, daySlug: d.daySlug, raceId: d.raceId, carrera: d.name, genero: d.gender, categoria: d.uciCategory, fecha: d.dateKey, etapa: Number(d.stageNumber), unDia: Number(d.ridingDays) === 1, lugar: [d.startLocation, d.finishLocation].filter(Boolean).join(' → '), videosCargados: Number(d.videos), seleccion: sel, estado, perdidasPorInsercion: perdidas, candidatos: cands });
}
const recapsOut = {};
for (const [raceId, m] of recaps) recapsOut[raceId] = [...m.values()].map((x) => ({ id: x.id, canal: x.channel, titulo: x.title, segundos: x.duration }));
fs.writeFileSync(path.join(A.salida, 'manifiesto.json'), JSON.stringify({ generado: new Date().toISOString(), cubiertasPorYouTube: cubiertas.map((d) => ({ dayId: d.dayId, carrera: d.name, fecha: d.dateKey, etapa: Number(d.stageNumber), emision: d.ytVerificada })), emisionYouTubeNoVisibleEnEuropa: descubiertasPorGeo.map((d) => ({ dayId: d.dayId, carrera: d.name, fecha: d.dateKey, etapa: Number(d.stageNumber), emision: d.ytVerificada })), dias: manifiesto, recapsPorCarrera: recapsOut, canalesAjenosConTitulosValidos: Object.fromEntries([...ajenos].sort((a, b) => b[1] - a[1])) }, null, 1));

// 5. Informe
const porCarrera = new Map();
for (const m of manifiesto) {
  const k = `${m.genero === 'female' ? 'F' : 'M'} ${m.categoria} ${m.carrera}`;
  const a = porCarrera.get(k) || { dias: 0, resumen: 0, ultimo: 0, vacios: [] };
  a.dias++;
  if (m.seleccion.summary.length) a.resumen++;
  if (m.seleccion.last_km.length) a.ultimo++;
  if (m.estado === 'vacio') a.vacios.push(m.unDia ? 'único' : `E${m.etapa}`);
  if (m.estado === 'pendiente') a.vacios.push(`${m.unDia ? 'único' : 'E' + m.etapa} (pendiente)`);
  porCarrera.set(k, a);
}
let md = `# Informe del sondeo\n\nGenerado ${new Date().toISOString()}. Jornadas sondeadas: ${manifiesto.length}; cubiertas por emisión de YouTube y excluidas: ${cubiertas.length}.\n\n`;
const tot = { c: 0, p: 0, v: 0, x: 0 }; for (const m of manifiesto) tot[m.estado === 'completo' ? 'c' : m.estado === 'parcial' ? 'p' : m.estado === 'pendiente' ? 'x' : 'v']++;
md += `Resumen y último kilómetro: ${tot.c}. Solo uno de los dos: ${tot.p}. Ninguno: ${tot.v}. Pendientes de verificar: ${tot.x}.\n\n| Carrera | Jornadas | Con resumen | Con último km | Sin nada |\n| --- | --: | --: | --: | --- |\n`;
for (const [k, a] of porCarrera) md += `| ${k} | ${a.dias} | ${a.resumen} | ${a.ultimo} | ${a.vacios.join(', ') || '—'} |\n`;
const perd = manifiesto.filter((m) => m.perdidasPorInsercion.summary || m.perdidasPorInsercion.last_km);
md += `\n## Jornadas sin vídeo por inserción desactivada (D3)\n\n${perd.length} jornadas.\n`;
for (const m of perd) md += `- ${m.carrera} ${m.unDia ? '' : 'E' + m.etapa} ${m.fecha}: resumen ${m.perdidasPorInsercion.summary}, último km ${m.perdidasPorInsercion.last_km}\n`;
const infSel = manifiesto.flatMap((m) => ['summary', 'last_km'].flatMap((k) => m.seleccion[k].map((id) => ({ m, c: m.candidatos.find((x) => x.id === id) }))).filter((x) => x.c.inferido));
md += `\n## Vídeos inferidos seleccionados, a revisar (D5)\n\n${infSel.length}\n`;
for (const { m, c } of infSel) md += `- ${m.carrera} ${m.unDia ? '' : 'E' + m.etapa}: ${c.canal} · ${c.titulo.slice(0, 90)} · ${c.url}\n`;
const pequeSel = manifiesto.flatMap((m) => ['summary', 'last_km'].flatMap((k) => m.seleccion[k].map((id) => ({ m, c: m.candidatos.find((x) => x.id === id) }))).filter((x) => x.c.pequeno));
md += `\n## Vídeos seleccionados de canales pequeños de organizador (menos de 1 000 suscriptores)\n\n${pequeSel.length}\n`;
const porCanalPeque = new Map(); for (const { c } of pequeSel) porCanalPeque.set(c.canal, (porCanalPeque.get(c.canal) || 0) + 1);
for (const [k, n] of porCanalPeque) md += `- ${k}: ${n}\n`;
md += `\n## Canales fuera de la lista con títulos válidos\n\n`;
for (const [k, n] of [...ajenos].sort((a, b) => b[1] - a[1]).slice(0, 30)) md += `- ${k.split('|')[1]} (${k.split('|')[0]}): ${n}${excluidoPorId.has(k.split('|')[0]) ? ' — excluido: ' + excluidoPorId.get(k.split('|')[0]).motivo : ''}\n`;
fs.writeFileSync(path.join(A.salida, 'informe.md'), md);
console.log(md.split('\n').slice(0, 6).join('\n'));
console.error(`\nmanifiesto.json e informe.md en ${A.salida}`);
