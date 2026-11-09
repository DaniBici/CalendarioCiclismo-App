// <head> de jornadas e inscritos, ES y EN, sin Python: traslado de sus tramos de
// tools/site/gen_og_pages.py. `publicacion.mjs head` lo coteja con esa salida.
// Depende de las ayudas de js/shared.js, ya espejo de las de Python, que el
// trabajador recibe tras instalar el entorno de navegador.
const BASE = 'https://calendariociclismo.app';
const BASE_EN = `${BASE}/en`;
const IMAGEN = 'https://assets.calendariociclismo.app/og/calendario-ciclismo.jpg';
const IMAGEN_ALT = 'Calendario Ciclismo';
const ROBOTS_INDEX = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';
const TIPOS_ES = {
  flat: 'Llana', rolling: 'Sinuosa', cotas: 'Cotas', medium_mountain: 'Media montaña', high_mountain: 'Alta montaña',
  cobbles: 'Adoquines', sterrato: 'Sterrato', itt: 'CRI', ttt: 'CRE', summit_finish: 'Final en alto',
  uphill_finish: 'Final en repecho', chrono_climb: 'Cronoescalada', monopuerto: 'Monopuerto', ribinou: 'Ribinou',
};
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TEMA = '<script>!function(){var l=window.matchMedia("(prefers-color-scheme: light)").matches,d=document.documentElement;d.classList.toggle("light",l);d.classList.toggle("dark",!l);d.style.backgroundColor=l?"#eef1f5":"#0b0c0f";d.style.colorScheme=l?"light":"dark"}()</script>';

const esc = value => (value == null ? '' : String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;'));
const texto = value => value ?? '';
const url = value => encodeURIComponent(value);

function partesFecha(clave) {
  const [y, m, d] = String(clave).split('-').map(Number);
  return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}
function fechaLargaEs(clave) {
  if (!clave) return '';
  const { y, m, d, dow } = partesFecha(clave);
  return Number.isFinite(dow) ? `${DIAS[dow]} ${d} de ${MESES[m - 1]} de ${y}` : clave;
}
function fechaLargaEn(clave) {
  const { y, m, d, dow } = partesFecha(clave);
  return Number.isFinite(dow) ? `${WEEKDAYS[dow]} ${d} ${MONTHS[m - 1]} ${y}` : clave;
}

// Grupo canónico: slugs de una misma jornada; el más corto es el maestro.
function normalizar(value) {
  return String(value || '').normalize('NFKD').replace(/[^\x00-\x7F]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function grupo(rd) {
  return [rd.raceId ?? '', rd.stageNumber ?? '', rd.dateKey ?? '', normalizar(rd.startLocation), normalizar(rd.finishLocation)].join('|');
}
/** La jornada maestra de `rd` entre las publicadas de su carrera. */
export function jornadaMaestra(rd, dias) {
  const clave = grupo(rd);
  const iguales = dias.filter(dia => dia.slug && grupo(dia) === clave);
  const [maestra] = [...iguales].sort((a, b) => a.slug.length - b.slug.length || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return maestra || rd;
}

function migas(items) {
  return {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, item], at) => ({ '@type': 'ListItem', position: at + 1, name, ...(item ? { item } : {}) })),
  };
}

function evento({ name, start, end, url: enlace, description, lugar, pais, cancelada, publicada = null, modificada = null, organizador = null, web = null, igualA = null, deporte = 'Ciclismo en ruta' }) {
  if (!(name && start && end && lugar && pais)) return null;
  return {
    '@context': 'https://schema.org', '@type': 'SportsEvent', name, url: enlace, description, sport: deporte,
    eventStatus: cancelada ? 'https://schema.org/EventCancelled' : 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    ...(organizador && web ? { organizer: { '@type': 'Organization', name: organizador, url: web } } : {}),
    startDate: start, endDate: end,
    ...(publicada ? { datePublished: publicada } : {}),
    ...(modificada ? { dateModified: modificada } : {}),
    image: IMAGEN,
    location: { '@type': 'Place', name: lugar, address: { '@type': 'PostalAddress', addressCountry: pais } },
    mainEntityOfPage: { '@type': 'WebPage', '@id': enlace },
    ...(igualA ? { sameAs: igualA } : {}),
  };
}

const robots = race => {
  const year = Number(race.year);
  return Number.isInteger(year) && year >= 2020 && year <= 2025 ? 'noindex, follow' : ROBOTS_INDEX;
};

function lugarEvento(misma, inicio, fin) {
  if (misma && inicio) return inicio;
  if (inicio && fin) return `${inicio} → ${fin}`;
  return inicio || null;
}

/** Campos del <head> ES. `ayudas`: articuloNombre, conArticulo, deArticulo, originalNameDistinto, raceSearchName. */
function camposEs(rd, race, dias, ayudas) {
  const nombre = texto(race.name);
  const original = ayudas.originalNameDistinto(nombre, race.originalName);
  const conOriginal = original ? `${nombre} (${original})` : nombre;
  const year = texto(race.year);
  const unDia = race.raceFormat === 'one_day';
  const numero = rd.stageNumber;
  const inicio = rd.startLocation || '';
  const fin = rd.finishLocation || '';
  const misma = !fin || inicio === fin;
  const km = rd.distanceKm;
  const fecha = rd.dateKey || '';
  const descanso = !!rd.isRestDay;
  const larga = fechaLargaEs(fecha);
  const etiqueta = numero == null ? '' : Number(numero) === 0 ? 'Prólogo' : `Etapa ${Number(numero)}`;
  const tipo = (rd.primaryType || rd.secondaryType || '').trim();
  const kmTexto = km ? `${String(km).replace('.', ',')} km` : '';
  const ruta = misma ? inicio : `${inicio} › ${fin}`;
  const SUFIJO = ' - Calendario Ciclismo App';
  let titulo;
  let visible;
  if (unDia) {
    const cola = [ruta, kmTexto].filter(Boolean).join(' · ');
    titulo = `${nombre}${year ? ` ${year}` : ''}${cola ? `: ${cola}` : ''}${SUFIJO}`;
    visible = `${nombre}${year ? ` ${year}` : ''}`;
  } else if (descanso) {
    titulo = `${nombre} ${year}, ${etiqueta || 'Descanso'}: Jornada de descanso${SUFIJO}`;
    visible = `${nombre} ${year} · ${etiqueta || 'Descanso'}`;
  } else {
    const busqueda = ayudas.raceSearchName(race, nombre);
    const cabeza = (etiqueta ? `${etiqueta} ${ayudas.deArticulo(busqueda)} ${busqueda} ${year}` : `${busqueda} ${year}`).trim();
    titulo = `${ruta ? `${cabeza}: ${ruta}` : cabeza}${kmTexto ? ` · ${kmTexto}` : ''}${SUFIJO}`;
    visible = etiqueta ? `${nombre} ${year} · ${etiqueta}` : `${nombre} ${year}`;
    if (ruta && etiqueta) visible = `${visible} - ${ruta}`;
  }
  const rutaTexto = misma && inicio ? `con salida y meta en ${inicio}` : fin ? `con salida en ${inicio} y meta en ${fin}` : '';
  const entre = larga ? (original ? `, ${larga},` : ` (${larga})`) : '';
  const capital = larga ? larga[0].toUpperCase() + larga.slice(1) : '';
  const art = ayudas.articuloNombre(nombre);
  const conArt = ayudas.conArticulo(nombre, conOriginal, art);
  const deArt = ayudas.deArticulo(nombre, art);
  const cuerpo = km ? `cubre ${String(km).replace('.', ',')} km${rutaTexto ? ` ${rutaTexto}` : ''}` : rutaTexto ? `se disputa ${rutaTexto}` : 'se disputa';
  const COLA = 'Consulta recorrido, horarios y cómo ver por TV y online streaming.';
  let descripcion;
  if (descanso) {
    descripcion = `Jornada de descanso ${deArt} ${conOriginal} ${year}${capital ? ` - ${capital}` : ''}.`;
  } else if (unDia) {
    descripcion = `${conArt[0].toUpperCase()}${conArt.slice(1)}${entre} ${cuerpo}. ${COLA}`;
  } else {
    const ordinal = numero == null ? '' : Number(numero) === 0 ? 'prólogo' : `etapa ${Number(numero)}`;
    descripcion = `${ordinal === 'prólogo' ? 'El' : 'La'} ${ordinal} ${deArt} ${conOriginal}${entre} ${cuerpo}. ${COLA}`;
  }
  const tituloOg = unDia ? `${nombre} ${year}` : titulo.replace(SUFIJO, '');
  const maestra = jornadaMaestra(rd, dias);
  const canonica = `${BASE}/jornada/${url(maestra.slug || rd.slug)}/`;
  const alterna = maestra.slugEn && (race.nameEn || race.name) ? `${BASE_EN}/stage/${url(maestra.slugEn)}/` : null;
  const crumbs = [['Inicio', `${BASE}/`]];
  if (year) crumbs.push([`Temporada ${year}`, `${BASE}/calendario/?year=${year}`]);
  if (race.slug && !unDia) crumbs.push([year ? `${nombre} ${year}` : nombre, `${BASE}/competicion/${url(race.slug)}/`]);
  if (unDia) {
    crumbs.push([visible, null]);
  } else {
    let final = etiqueta || inicio || visible;
    if (!misma && fin) final = etiqueta ? `${etiqueta}: ${inicio} › ${fin}` : `${inicio} › ${fin}`;
    else if (inicio && etiqueta) final = `${etiqueta}: ${inicio}`;
    crumbs.push([final, null]);
  }
  const actualizada = (rd.updatedAt || '').slice(0, 10) || null;
  const pais = String(rd.countryCode || race.countryCode || '').toUpperCase() || null;
  const ld = [];
  if (!descanso) {
    const start = rd.neutralStartTimeUtc || fecha || null;
    const principal = evento({
      name: tituloOg, start, end: rd.estimatedFinishTimeUtc || start, url: canonica, description: descripcion, lugar: lugarEvento(misma, inicio, fin),
      pais, cancelada: !!rd.isCancelledDay || !!race.isCancelled, publicada: fecha || null, modificada: actualizada || fecha || null,
      organizador: nombre, web: race.websiteUrl || null, igualA: race.websiteUrl || null,
    });
    if (principal) {
      const sobre = [];
      if (TIPOS_ES[tipo]) sobre.push({ '@type': 'Thing', name: `Tipo de etapa: ${TIPOS_ES[tipo]}` });
      if (ruta) sobre.push({ '@type': 'Thing', name: `Recorrido: ${ruta}` });
      if (kmTexto) sobre.push({ '@type': 'Thing', name: `Distancia: ${kmTexto}` });
      if (sobre.length) principal.about = sobre;
      ld.push(principal);
    }
  }
  ld.push(migas(crumbs));
  return { titulo, descripcion, canonica, alterna, ld, publicada: fecha || null, modificada: actualizada || fecha || null };
}

function camposEn(rd, race, dias) {
  const nombre = race.nameEn || race.name || '';
  const year = race.year || '';
  const unDia = race.raceFormat === 'one_day';
  const descanso = !!rd.isRestDay;
  const cancelada = !!rd.isCancelledDay || !!race.isCancelled;
  let canonica = `${BASE_EN}/stage/${url(rd.slugEn)}/`;
  let alterna = null;
  if (rd.slug) {
    const maestra = jornadaMaestra(rd, dias);
    alterna = `${BASE}/jornada/${url(maestra.slug)}/`;
    if (maestra.slugEn) canonica = `${BASE_EN}/stage/${url(maestra.slugEn)}/`;
  }
  const propia = rd.translations?.en?.description;
  const valorPropio = propia && typeof propia === 'object' ? propia.value : null;
  const numero = rd.stageNumber;
  const etiqueta = numero === 0 ? 'Prologue' : numero ? `Stage ${numero}` : '';
  const fecha = rd.dateKey || '';
  const inicio = rd.startLocationEn || rd.startLocation || '';
  const fin = rd.finishLocationEn || rd.finishLocation || '';
  const misma = !fin || inicio === fin;
  const km = rd.distanceKm;
  const kmTexto = km ? `${km} km` : '';
  const ruta = misma ? inicio : `${inicio} › ${fin}`;
  const base = year ? `${nombre} ${year}`.trim() : nombre;
  let titulo;
  if (descanso) {
    titulo = `${base}, ${etiqueta || 'Rest day'}: Rest day`;
  } else if (unDia) {
    const cola = [ruta, kmTexto].filter(Boolean).join(' · ');
    titulo = `${base}${cola ? `: ${cola}` : ''}`;
  } else {
    titulo = etiqueta ? `${nombre} - ${etiqueta}`.replace(/[- ]+$/, '').trim() : nombre;
    if (inicio && fin && inicio !== fin) titulo += ` · ${inicio} › ${fin}`;
    else if (fin || inicio) titulo += ` · ${fin || inicio}`;
  }
  let descripcion;
  if (descanso) {
    descripcion = `Rest day of ${nombre} ${year}.`.trim();
  } else if (unDia) {
    const parteRuta = inicio && fin && inicio !== fin ? `, from ${inicio} to ${fin}` : fin ? `, finishing in ${fin}` : '';
    descripcion = valorPropio || `${nombre} ${year}${parteRuta}${kmTexto ? `, ${kmTexto}` : ''}. Schedule, broadcast info and route details.`.trim();
  } else {
    const parteRuta = inicio && fin && inicio !== fin ? ` from ${inicio} to ${fin}` : '';
    descripcion = valorPropio || `${etiqueta || 'Stage'} of ${nombre}${parteRuta}${kmTexto ? ` (${kmTexto})` : ''}. Schedule, broadcast info and route details.`;
  }
  if (!descanso && !valorPropio && fecha) descripcion += ` ${fechaLargaEn(fecha)}.`;
  const crumbs = [['Home', `${BASE_EN}/`]];
  if (year) crumbs.push([`${year} season`, `${BASE_EN}/season/`]);
  const slugCarrera = race.slugEn || race.slug || '';
  if (slugCarrera && !unDia) crumbs.push([year ? `${nombre} ${year}`.trim() : nombre, `${BASE_EN}/race/${url(slugCarrera)}/`]);
  crumbs.push([unDia ? titulo.split(':')[0].trim() : etiqueta || titulo, null]);
  const ld = [];
  if (!descanso) {
    const start = rd.neutralStartTimeUtc || fecha || null;
    const principal = evento({
      name: unDia && year ? `${nombre} ${year}`.trim() : titulo, start, end: rd.estimatedFinishTimeUtc || start, url: canonica, description: descripcion,
      lugar: lugarEvento(misma, inicio, fin), pais: String(rd.countryCode || race.countryCode || '').toUpperCase() || null, cancelada,
      organizador: nombre, web: race.websiteUrl || null, deporte: 'Road cycling',
    });
    if (principal) ld.push(principal);
  }
  ld.push(migas(crumbs));
  const actualizada = (rd.updatedAt || '').slice(0, 10) || null;
  return { titulo, descripcion, canonica, alterna, ld, publicada: fecha || null, modificada: actualizada || fecha || null };
}

function camposInscritosEs(race, recuentos, ayudas) {
  const nombre = texto(race.name);
  const original = ayudas.originalNameDistinto(nombre, race.originalName);
  const conOriginal = original ? `${nombre} (${original})` : nombre;
  const year = texto(race.year);
  const art = ayudas.articuloNombre(nombre);
  const femenina = race.gender === 'female';
  const provisional = !!race.startlistProvisional;
  const etiqueta = provisional ? 'Lista provisional' : 'Dorsales';
  const nota = provisional ? ' (provisional, sujeta a cambios)' : '';
  const corredores = femenina ? 'corredoras inscritas' : 'corredores inscritos';
  const conArt = ayudas.conArticulo(nombre, conOriginal, art);
  const descripcion = recuentos.teams > 0 && recuentos.riders > 0
    ? `Lista de ${recuentos.teams} equipos y ${recuentos.riders} ${corredores} en ${conArt} ${year}${nota}. Dorsales y participantes.`
    : `Lista de equipos y ${corredores} en ${conArt} ${year}${nota}. Dorsales y participantes.`;
  const cola = provisional ? 'lista provisional de inscritos' : `dorsales y ${corredores}`;
  const titulo = `${ayudas.raceSearchName(race, nombre)} ${year}: ${cola} - Calendario Ciclismo App`;
  const canonica = `${BASE}/inscritos/${url(race.slug)}/`;
  const alterna = race.slugEn && (race.nameEn || race.name) ? `${BASE_EN}/startlist/${url(race.slugEn)}/` : null;
  const ld = [migas([
    ['Inicio', `${BASE}/`],
    [year ? `Temporada ${year}` : 'Temporada', `${BASE}/calendario/${year ? `?year=${year}` : ''}`],
    [year ? `${nombre} ${year}` : nombre, `${BASE}/competicion/${url(race.slug)}/`],
    [etiqueta, null],
  ])];
  return { titulo, descripcion, canonica, alterna, ld, publicada: null, modificada: null };
}

function camposInscritosEn(race) {
  const nombre = race.nameEn || race.name || '';
  const year = race.year || '';
  const crumbs = [
    ['Home', `${BASE_EN}/`],
    [year ? `${year} season` : 'Season', `${BASE_EN}/season/`],
    [`${nombre} ${year}`.trim(), `${BASE_EN}/race/${url(race.slugEn)}/`],
    ['Startlist', null],
  ];
  return {
    titulo: `${nombre} ${year} - Startlist`.trim(), descripcion: `Full startlist for ${nombre} ${year}.`.trim(),
    canonica: `${BASE_EN}/startlist/${url(race.slugEn)}/`, alterna: race.slug ? `${BASE}/inscritos/${url(race.slug)}/` : null,
    ld: [migas(crumbs)], publicada: null, modificada: null,
  };
}

/** <head> completo, hasta `</head>`. `activos`: rutas de tema, CSS y fuente. `extra`: etiquetas finales. */
function cabezaHtml(lang, campos, race, ids, activos, extra) {
  const en = lang === 'en';
  const { titulo, descripcion, canonica, alterna, ld, publicada, modificada } = campos;
  const alternativas = en
    ? `<link rel="alternate" hreflang="en" href="${esc(canonica)}"/>${alterna ? `\n<link rel="alternate" hreflang="es" href="${esc(alterna)}"/>\n<link rel="alternate" hreflang="x-default" href="${esc(alterna)}"/>` : ''}
<link rel="alternate" type="application/atom+xml" title="Calendario Ciclismo" href="${BASE}/atom.xml">`
    : `<link rel="alternate" hreflang="es" href="${esc(canonica)}">${alterna ? `\n<link rel="alternate" hreflang="en" href="${esc(alterna)}">` : ''}
<link rel="alternate" hreflang="x-default" href="${esc(canonica)}">
<link rel="alternate" type="application/atom+xml" title="Calendario Ciclismo App - Próximas jornadas" href="${BASE}/atom.xml">
<link rel="alternate" type="text/plain" title="LLMs.txt" href="${BASE}/llms.txt">`;
  const scripts = ld.map(obj => `\n<script type="application/ld+json" id="${obj['@type'] === 'SportsEvent' ? 'jsonld-main' : 'jsonld-breadcrumbs'}">${JSON.stringify(obj).replace(/<\//g, '<\\/')}</script>`).join('');
  const metaIds = Object.entries(ids).map(([nombre, valor]) => `\n<meta name="cc:${nombre}" content="${esc(valor)}">`).join('');
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
${TEMA}
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" content="#141414" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="robots" content="${esc(robots(race))}">
<meta name="apple-itunes-app" content="app-id=6761902611">${publicada ? `<meta name="date" content="${esc(publicada)}">` : ''}${modificada ? `<meta name="last-modified" content="${esc(modificada)}">` : ''}
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(descripcion)}">
<link rel="canonical" href="${esc(canonica)}">
${alternativas}${activos.conSupabase ? '\n<link rel="preconnect" href="https://bcecwlkynpgovnzhbpah.supabase.co" crossorigin>' : ''}
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="preconnect" href="https://assets.calendariociclismo.app">${metaIds}
<meta property="og:type" content="website">
<meta property="og:locale" content="${en ? 'en_GB' : 'es_ES'}">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:description" content="${esc(descripcion)}">
<meta property="og:url" content="${esc(canonica)}">
<meta property="og:image" content="${IMAGEN}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${IMAGEN_ALT}">
<meta property="og:site_name" content="${en ? 'Calendario Ciclismo' : 'Calendario Ciclismo App'}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(titulo)}">
<meta name="twitter:description" content="${esc(descripcion)}">
<meta name="twitter:image" content="${IMAGEN}">
<meta name="twitter:image:alt" content="${IMAGEN_ALT}">${scripts}
<script src="${activos.tema}"></script>${activos.fuente ? `\n<link rel="stylesheet" href="${activos.fuente}">` : ''}
<link rel="stylesheet" href="${activos.css}">
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="96x96" href="/favicon-96x96.png">
${extra}
</head>`;
}

export function cabezaJornada(lang, rd, race, dias, activos, ayudas, extra = '') {
  const campos = lang === 'en' ? camposEn(rd, race, dias) : camposEs(rd, race, dias, ayudas);
  return cabezaHtml(lang, campos, race, { 'race-day-id': rd.id, 'race-id': rd.raceId }, activos, extra);
}

export function cabezaInscritos(lang, race, recuentos, activos, ayudas, extra = '') {
  const campos = lang === 'en' ? camposInscritosEn(race) : camposInscritosEs(race, recuentos, ayudas);
  return cabezaHtml(lang, campos, race, { 'race-id': race.id }, activos, extra);
}
