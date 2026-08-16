// ─────────────────────────────────────────────────────────────────
//  i18n — Sistema de internacionalización para calendariociclismo.app
//  Idiomas: es (default), en
//  Detecta idioma desde: ruta /en/*, host EN_DOMAIN (config.js), o
//  localStorage cc_lang.
// ─────────────────────────────────────────────────────────────────

// ── Diccionario ES (fuente de verdad) ────────────────────────────
const LOCALES = {
  es: {
    nav: {
      today: 'Hoy', month: 'Mes', apps: 'Apps', about: 'Sobre',
      search: 'Buscar', themeToggle: 'Cambiar tema',
      subscribe: 'Suscribirse', icalCalendar: 'Calendario iCal', privacy: 'Privacidad',
    },
    cal: {
      noRaces: 'Sin carreras',
    },
    transfers: {
      title: 'Fichajes',
      heading: 'Mercado de Fichajes {season}',
      feedTitle: 'Últimas confirmaciones',
      feedSignings: 'Fichajes',
      midSeason: 'M. Temporada',
      feedRenewals: 'Renovaciones',
      feedEmpty: 'Todavía no hay movimientos confirmados.',
      loadMore: 'Cargar más',
      renews: 'renueva con',
      retires: 'se retira',
      retired: 'Se retira',
      until: '{year}',
      rumor: 'Rumor',
      doubt: 'Duda',
      teamDoubt: 'En duda',
      teamDoubtNotice: 'La continuidad del equipo en {season} no está confirmada.',
      teamsTitle: 'Equipos {season}',
      teamsEmpty: 'Sin equipos en esta división.',
      back: 'Todos los equipos',
      staying: 'Continúan',
      doubtful: 'En duda',
      contractEnds: 'Terminan contrato',
      arrivals: 'Llegan',
      departures: 'Se marchan',
      stayingEmpty: 'Sin corredores en la plantilla actual.',
      doubtfulEmpty: 'Sin corredores en duda por ahora.',
      contractEndsEmpty: 'Sin finales de contrato anunciados por ahora.',
      arrivalsEmpty: 'Sin llegadas anunciadas por ahora.',
      departuresEmpty: 'Sin salidas anunciadas por ahora.',
      teamEmpty: 'Sin movimientos anunciados por ahora.',
      unknownTeam: 'Por confirmar',
      loading: 'Cargando Mercado de Fichajes',
      loadError: 'No se pudo cargar el mercado de fichajes.',
      infoLabel: 'Información sobre los fichajes',
      infoModalTitle: 'Fuentes de Fichajes',
      close: 'Cerrar',
      infoText: 'La información del mercado de fichajes —altas, bajas y renovaciones— se contrasta con los anuncios de los equipos y con el trabajo de periodistas especializados que siguen y adelantan los movimientos temporada a temporada. Agradecemos especialmente el seguimiento de:',
    },
    stage: {
      prologue: 'Prólogo', prologueShort: 'Pról', stage: 'Etapa', stageShort: 'E',
      restDay: 'Descanso', cancelled: 'Cancelada',
      // Las usa competicion.js; existían solo en i18n/en.json → en ES el badge
      // imprimía la clave cruda ("stage.stageCancelledBadge").
      stageCancelledBadge: 'Cancelada', stageCancelledTooltip: 'Etapa cancelada',
      previous: 'Etapa anterior', next: 'Etapa siguiente',
      viewAll: 'Ver todas las etapas', summary: 'Resumen',
      pickStage: 'Elegir etapa',
      oneDay: 'Clásica', stageTour: 'Vuelta por etapas',
      route: 'Recorrido', distanceAndType: 'Distancia y tipo',
      schedule: 'Horarios', yourTimezone: 'Tu zona horaria', madridTimezone: 'España peninsular',
      noData: 'Sin datos', noSchedule: 'Sin horarios',
      results: 'Resultados',
      viewResults: 'Ver clasificaciones',
      sameTime: 'm.t.',
      alsoOn: 'También en',
      previousResults: 'Así está la carrera',
      descriptionRace: 'Descripción de la carrera', descriptionStage: 'Descripción de la etapa',
      bonuses: 'Bonificaciones', notes: 'Notas',
      websiteLabel: 'Web oficial', startlistLabel: 'Dorsales', startlistLabelFemale: 'Dorsales', startlistProvisional: 'Lista provisional',
      stagesCount_one: '{n} etapa', stagesCount_other: '{n} etapas',
      racesCount_one: '{n} carrera', racesCount_other: '{n} carreras',
      addToCalendar: 'Añadir al calendario', reportChanges: 'Reportar cambios',
      watch: 'Ver',
      startFirstRider: 'Salida 1º corredor', startFirstRiderF: 'Salida 1ª corredora',
      startFirstTeam: 'Salida 1º equipo', neutralStart: 'Salida neutralizada',
      finishLastRider: 'Meta último corredor', finishLastRiderF: 'Meta última corredora',
      finishLastTeam: 'Meta último equipo', estimatedFinish: 'Llegada prevista',
      guide: {
        open: 'Ver horarios de paso', title: 'Horarios de paso',
        estimatedNote: 'Las horas con * son estimaciones; el resto provienen del rutómetro.',
        start: 'Salida', finish: 'Llegada',
        climbFoot: 'Pie de {name}', climbFootGeneric: 'Pie de puerto',
        summit: 'Cima', kmToGo: 'a {km} km', atFinish: 'Meta',
        intermediate_sprint: 'Sprint intermedio', bonus_sprint: 'Sprint bonificación',
        intermediate_split: 'Punto intermedio', cobblestone: 'Pavé',
        sterrato: 'Sterrato', town: 'Localidad',
      },
    },
    types: {
      flat: 'Llana', rolling: 'Sinuosa', cotas: 'Cotas',
      medium_mountain: 'Media montaña', high_mountain: 'Alta montaña',
      cobbles: 'Adoquines', sterrato: 'Sterrato', itt: 'CRI', ttt: 'CRE',
      summit_finish: 'Final en alto', uphill_finish: 'Final en repecho',
      chrono_climb: 'Cronoescalada', monopuerto: 'Monopuerto', ribinou: 'Ribinou',
    },
    tv: {
      title: 'Televisión', reviveRace: 'Revive', reviveStage: 'Revive', reviveRaceTitle: 'Revive la carrera', reviveStageTitle: 'Revive la etapa',
      localTimezone: 'Horarios en tu hora local ({tz})', madridLabel: 'Madrid: {time}',
      noInfo: 'Sin información de TV', noTvCountry: 'No hay TV en tu país', fullStage: 'Íntegra',
      filterAll: 'Todas', filterMine: 'Mi país',
      status: { pending: 'Sin confirmar', none: 'Sin TV', unavailable_es: 'No TV España' },
    },
    assets: {
      startOrder: 'Orden Salida', technicalGuide: 'Libro de Ruta', roadbook: 'Rutómetro', profile: 'Perfil',
      profileOfficial: 'Perfil', profileInteractive: 'Perfil + Datos',
      ports: 'Puertos', pave: 'Pavé', sterrato: 'Sterrato', ribinou: 'Ribinou',
      map: 'Mapa', mapOfficial: 'Mapa', mapInteractive: 'Mapa 3D',
      live_text: 'Live texto', general: 'General',
    },
    months: {
      short: ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'],
      long: ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'],
      all: 'Todos',
    },
    days: { short: ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'], singular: 'día', plural: 'días' },
    terrain: { cobblestone: 'Pavé', sterrato: 'Sterrato', ribinou: 'Ribinou' },
    filter: {
      all: 'Todas', pro: 'Pro', worldtour: 'WorldTour', wwt: 'WWT',
      male: 'Masculino', female: 'Femenino', male_short: 'Masc', female_short: 'Fem',
    },
    sort: { label: 'Ordenar', category: 'Cat. UCI', tvtime: 'Hora TV', finishtime: 'Hora Meta' },
    search: {
      placeholder: 'Buscar carreras…', noResults: 'Sin resultados', loading: 'Cargando datos',
      error: 'Error al cargar los datos', inDescription: 'En descripción',
      start: 'Salida', finish: 'Meta', startAndFinish: 'Salida y meta',
    },
    startlist: {
      loading: 'Cargando inscritos', notFound: 'No se encontró la carrera solicitada.',
      empty: 'No hay lista de inscritos disponible para esta carrera.',
      label: 'Dorsales', labelFemale: 'Dorsales', provisional: 'Lista provisional',
      provisionalNote: ' (provisional, sujeta a cambios)',
      downloadPdf: 'Descargar PDF', generatingPdf: 'Generando…',
      // Motivo de abandono en el tooltip del corredor (lista con resultados in-house).
      dnfReasonStage: '{label} · etapa {n}',
      dnfReasonPrologue: '{label} · prólogo',
      dnfReason: '{label}',
    },
    results: {
      chip: 'Resultados', feedTitle: 'Últimos resultados', chipBack: 'Calendario',
    },
    race: {
      cancelled: 'Carrera cancelada', stageCancelled: 'Etapa cancelada',
      unknown: 'Carrera desconocida', error: 'Error al cargar la carrera',
      errorCompetition: 'Error al cargar la competición', errorChallenge: 'Error al cargar el challenge',
      viewFull: 'Ver carrera completa',
    },
    loading: {
      stages: 'Cargando jornadas', month: 'Cargando calendario de mes',
      season: 'Cargando temporada', data: 'Cargando datos',
    },
    today: {
      heading: 'Hoy', todayBtn: 'Hoy', yesterday: 'Ayer', tomorrow: 'Mañana',
      races_one: '{n} carrera', races_other: '{n} carreras',
      noRaces: 'No hay carreras programadas para este día',
      noRacesFilter: 'No hay carreras con este filtro para el día seleccionado',
      nextDay: 'Ir al próximo día con carreras →',
      prevDayLabel: 'Día anterior',
      nextDayLabel: 'Día siguiente',
      racesFor: '{n} · {date}',
    },
    report: {
      title: 'Reportar cambio',
      nameLabel: 'Tu nombre', namePlaceholder: 'Nombre y apellido',
      emailLabel: 'Tu email', emailPlaceholder: 'correo@ejemplo.com',
      typeLabel: 'Tipo de cambio', typeSelect: 'Selecciona una opción',
      typeSchedule: 'Horario incorrecto', typeTV: 'Televisión / streaming',
      typeRoute: 'Recorrido / perfil', typeCancellation: 'Cancelación o aplazamiento',
      typeOther: 'Otro',
      messageLabel: 'Descripción del cambio',
      messagePlaceholder: 'Describe el cambio que has detectado...',
      submit: 'Enviar reporte', submitting: 'Enviando...',
      successTitle: 'Reporte enviado',
      successDesc: 'Gracias por ayudar a mejorar la información.',
      nameRequired: 'Por favor ingresa tu nombre.',
      emailInvalid: 'Por favor ingresa un correo válido.',
      cooldown: 'Por favor espera {secs} segundos antes de enviar otro reporte.',
      tooMany: 'Has enviado demasiados reportes. Inténtalo más tarde.',
      error: 'No se pudo enviar el reporte. Inténtalo de nuevo.',
    },
    ical: {
      title: 'Suscripción al calendario',
      closeLabel: 'Cerrar',
      thisStageSection: 'Esta jornada',
      onlyThisStage: 'Solo esta jornada',
      orSubscribeSeason: 'o suscríbete a toda la temporada',
      season: 'Temporada',
      copyLabel: 'Copiar URL',
      subscribeLabel: 'Suscribirse',
      thisStageDefault: 'Esta jornada',
      feeds: {
        todo: 'Todo', todoDesc: 'Todas las categorías, ambos géneros',
        pro: 'Pro', proDesc: 'Todas las categorías hasta .1',
        wt: 'WorldTour', wtDesc: 'UCI WorldTour masculino (1.UWT / 2.UWT)',
        wwt: 'WWT', wwtDesc: 'UCI WorldTour femenino (1.WWT / 2.WWT)',
        masc: 'Masculino', mascDesc: 'Todas las pruebas masculinas hasta .1',
        fem: 'Femenino', femDesc: 'Todas las pruebas femeninas hasta .1 y también .2 europeas',
      },
    },
    season: { countryPlaceholder: 'Países' },
    footer: { credits: 'Ideado y editado por' },
    seo: {
      siteName: 'Calendario Ciclismo App',
      defaultTitle: 'Calendario Ciclismo App',
      defaultDesc: 'Todas las carreras ciclistas profesionales, con horario, recorrido, perfil y cómo ver por TV y online streaming.',
    },
    locale: { code: 'es-ES', lang: 'es' },
    profile: {
      notFound: 'Perfil no encontrado.',
      notAvailable: 'Perfil no disponible.',
      noElevation: 'Sin datos de elevación GPX para esta jornada.',
      keyPoints: 'Puntos clave',
      climbs: 'Puertos',
      sprints: 'Sprints',
      splits: 'Puntos intermedios',
      sectors: 'Sectores',
      bonusSprint: 'Bonificación',
      intSprint: 'Sprint Int.',
      distance: 'Distancia',
      startMadrid: 'Salida · Madrid: {time}',
      finishMadrid: 'Llegada · Madrid: {time}',
      seoDesc: 'Perfil de elevación de {title}: {n} puertos, {s} sprints.',
      seoDescNoAnnot: 'Perfil de elevación de {title}: recorrido, distancia y horarios.',
      pageTitle: 'Perfil',
      backToStage: 'Volver a la jornada',
      kmLabel: 'km',
      cat: 'Cat.',
      climbsOne: 'Puerto',
      splitsOne: 'Punto intermedio',
    },
    map: {
      pageTitle: 'Mapa del recorrido',
      notAvailable: 'Mapa no disponible para esta jornada.',
      loadError: 'No se pudo cargar el mapa del recorrido.',
      start: 'Salida',
      finish: 'Meta',
      baseMap: 'Mapa',
      satellite: 'Satélite',
      profile: 'Perfil',
      fullscreen: 'Pantalla completa',
      exitFullscreen: 'Salir de pantalla completa',
    },
  },
};

// EN se carga desde i18n/en.json en tiempo de build (y en runtime como fallback)
// Para uso síncrono en módulos, se importa el JSON directamente:
let _enLoaded = false;
async function _loadEN() {
  if (_enLoaded || LOCALES.en) return;
  try {
    const res = await fetch('/i18n/en.json');
    LOCALES.en = await res.json();
    _enLoaded = true;
  } catch { /* fallback to ES */ }
}

// ── Detección de idioma ──────────────────────────────────────────
// Prioridad: hostname === EN_DOMAIN > pathname /en/ > ?lang=
// El idioma lo determina exclusivamente la URL/hostname, no localStorage,
// para evitar que cc_lang='en' contamine páginas del dominio español.
function _detectLang() {
  // EN_DOMAIN se inyecta desde config.js (vacío hasta que exista el dominio inglés)
  const _enHost = (typeof CONFIG !== 'undefined' && CONFIG.enDomain) || window.EN_DOMAIN || null;
  if (_enHost && window.location.hostname === _enHost) {
    return 'en';
  }
  if (window.location.pathname.startsWith('/en/') || window.location.pathname === '/en') {
    return 'en';
  }
  // Fallback desde ?lang= (usado al redirigir desde 404 hacia jornada.html)
  try {
    const qs = new URLSearchParams(window.location.search);
    const qLang = qs.get('lang');
    if (qLang === 'en' || qLang === 'es') return qLang;
  } catch { /* ignore */ }
  return 'es';
}

let _lang = _detectLang();

export function getLang() { return _lang; }
export function setLang(lang) {
  _lang = lang;
  try { localStorage.setItem('cc_lang', lang); } catch { /* ignore */ }
}

// ── t(key) — función de traducción ──────────────────────────────
// key: notación dot-path, ej. 'types.flat', 'months.short'
// interpolation: t('tv.localTimezone', { tz: 'GMT+2' }) → 'Times in your local timezone (GMT+2)'
export function t(key, vars) {
  const dict = (LOCALES[_lang] ?? LOCALES.es);
  const parts = key.split('.');
  let val = dict;
  for (const p of parts) {
    if (val == null) break;
    val = val[p];
  }
  // Fallback a ES si la clave no existe en el idioma activo
  if (val == null && _lang !== 'es') {
    val = LOCALES.es;
    for (const p of parts) {
      if (val == null) break;
      val = val[p];
    }
  }
  if (val == null) return key;
  if (typeof val !== 'string') return val; // arrays/objects los devuelve tal cual
  if (!vars) return val;
  return val.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

export function getLocale() {
  return t('locale.code') || (_lang === 'en' ? 'en-GB' : 'es-ES');
}

// ── URLs base ────────────────────────────────────────────────────
export function getBaseUrl() {
  const origin = window.location.origin;
  if (_lang === 'en') {
    const _enHostBase = (typeof CONFIG !== 'undefined' && CONFIG.enDomain) || window.EN_DOMAIN || null;
    if (_enHostBase && window.location.hostname === _enHostBase) {
      return origin;
    }
    return `${origin}/en`;
  }
  return origin;
}

// Carga asíncrona del diccionario EN (llamar desde el entry point de páginas EN)
export async function initI18n() {
  if (_lang === 'en') await _loadEN();
}

// Exponer LOCALES para que el build script los exporte
export { LOCALES };
