import { describe, expect, it, vi } from 'vitest';

// shared.js crea el cliente de Supabase con los globales de js/config.js y, vía i18n.js, lee window.location al cargarse.
vi.hoisted(() => Object.assign(globalThis, { CONFIG: { basePath: '' }, SUPABASE_URL: '', SUPABASE_ANON_KEY: '', window: { location: { hostname: '', pathname: '/', search: '' } } }));
vi.mock('../supabase-client.js', () => ({ getSupabaseClient: () => ({}) }));

import { raceDateRangeText, raceDateKeys, raceCrumbItems, buildRaceBreadcrumb, buildStageTiles, buildRaceTotalTiles, buildRaceFacts, finishClimbText, stageTileLevels, buildActionLinks, buildActionButtons, raceLayoutHtml } from '../shared.js';

describe('rango de fechas de la carrera', () => {
  it('formatea un día, un mes, dos meses y dos años', () => {
    expect(raceDateRangeText('2026-10-20', '2026-10-20', 'es')).toBe('20 octubre 2026');
    expect(raceDateRangeText('2026-10-13', '2026-10-18', 'es')).toBe('13 - 18 octubre 2026');
    expect(raceDateRangeText('2026-09-29', '2026-10-04', 'es')).toBe('29 septiembre - 4 octubre 2026');
    expect(raceDateRangeText('2026-12-30', '2027-01-02', 'en')).toBe('30 December 2026 - 2 January 2027');
    expect(raceDateRangeText('', '', 'es')).toBe('');
  });
  it('usa las fechas de la carrera y, si faltan, las de las jornadas sin descansos', () => {
    expect(raceDateKeys({ startDate: '2026-10-13', endDate: '2026-10-18' }, [])).toEqual({ start: '2026-10-13', end: '2026-10-18' });
    const days = [{ dateKey: '2026-10-14' }, { dateKey: '2026-10-13' }, { dateKey: '2026-10-15', isRestDay: true }];
    expect(raceDateKeys({}, days)).toEqual({ start: '2026-10-13', end: '2026-10-14' });
  });
});

describe('migas de pan', () => {
  const stageRace = { id: 'r', slug: 'tour-x', name: 'Tour X', raceFormat: 'stages' };
  it('Inicio > carrera (enlace) > etapa (actual)', () => {
    const html = buildRaceBreadcrumb(raceCrumbItems(stageRace, { stageText: 'Etapa 3' }));
    expect(html).toContain('<nav class="race-crumbs"');
    expect(html).toContain('<a href="/">Inicio</a>');
    expect(html).toContain('<a href="/competicion/tour-x/">Tour X</a>');
    expect(html).toContain('<li aria-current="page">Etapa 3</li>');
  });
  it('en una prueba de un día la carrera es la página actual', () => {
    const html = buildRaceBreadcrumb(raceCrumbItems({ ...stageRace, raceFormat: 'one_day' }));
    expect(html).toContain('<li aria-current="page">Tour X</li>');
    expect(html).not.toContain('/competicion/');
  });
  it('sin migas suficientes no pinta nada', () => {
    expect(buildRaceBreadcrumb([])).toBe('');
  });
});

describe('teselas de la ficha de etapa', () => {
  const race = { countryCode: 'cn' };
  it('omite las teselas sin dato y marca el horario como neutro', () => {
    const html = buildStageTiles({ distanceKm: 211.9, elevationProfile: { elevationGain: 2087 }, primaryType: 'flat' }, race, { last: { label: 'Horario', value: '05:00 - 10:00' } });
    // 211,9 km → nivel 4; 2.090 m → 3; llana → 1.
    expect(html).toContain('stage-tile--l4 stage-tile--sm');
    expect(html).toContain('stage-tile--l3 stage-tile--sm');
    expect(html).toContain('stage-tile--l1 stage-tile--lg');
    expect(html).toContain('stage-tile--plain');
    expect(html).toContain('05:00 - 10:00');
    expect(html).not.toContain('>Final<');
  });
  it('colorea cada tesela según su nivel de dureza', () => {
    const lv = (km, m) => stageTileLevels({ distanceKm: km, elevationProfile: { elevationGain: m } });
    expect(lv(120, 800)).toMatchObject({ distance: 1, elevation: 1 });
    expect(lv(150, 1000)).toMatchObject({ distance: 2, elevation: 2 });
    expect(lv(165.6, 1720)).toMatchObject({ distance: 2, elevation: 2 });
    expect(lv(180, 2000)).toMatchObject({ distance: 3, elevation: 3 });
    expect(lv(210, 3000)).toMatchObject({ distance: 4, elevation: 4 });
    expect(lv(260, 4500)).toMatchObject({ distance: 5, elevation: 5 });
    expect(stageTileLevels({ primaryType: 'flat' }).type).toBe(1);
    expect(stageTileLevels({ primaryType: 'medium_mountain' }).type).toBe(4);
    expect(stageTileLevels({ primaryType: 'high_mountain' }).type).toBe(5);
    expect(stageTileLevels({ primaryType: 'flat', secondaryType: 'summit_finish' }).type).toBe(2);
    // Final de 3 km al 5 % → nivel 3.
    const points = [{ km: 0, alt: 0 }, { km: 10, alt: 0 }, { km: 13, alt: 150 }];
    expect(stageTileLevels({ distanceKm: 13, elevationProfile: { points }, profileSummits: [{ km: 13, startKm: 10 }] }).finish).toBe(3);
    expect(stageTileLevels({})).toEqual({ distance: null, elevation: null, type: null, finish: null });
  });
  it('sin ningún dato devuelve cadena vacía', () => {
    expect(buildStageTiles({}, race)).toBe('');
  });
  it('el final solo sale con cima de meta, pie conocido y perfil', () => {
    const points = [{ km: 0, alt: 0 }, { km: 10, alt: 0 }, { km: 13, alt: 150 }];
    const day = { distanceKm: 13, elevationProfile: { points }, profileSummits: [{ km: 13, startKm: 10 }] };
    expect(finishClimbText(day)).toMatch(/3 km .* 5,0 %/);
    expect(finishClimbText({ ...day, profileSummits: [{ km: 5, startKm: 2 }] })).toBe('');
    expect(finishClimbText({ ...day, elevationProfile: {} })).toBe('');
  });
});

describe('datos de carrera de la columna lateral', () => {
  it('categoría, fechas y país; sin país si se oculta la bandera', () => {
    const race = { uciCategory: 'UWT', countryCode: 'CN' };
    const html = buildRaceFacts(race, { startKey: '2026-10-13', endKey: '2026-10-18' });
    expect(html).toContain('UCI WorldTour');
    expect(html).toContain('13 - 18 octubre 2026');
    expect(html).toContain('race-header__fact--country');
    expect(buildRaceFacts(race, { startKey: '2026-10-13', countryCode: '' })).not.toContain('--country');
  });
});

describe('marco de la ficha y enlaces laterales en HTML', () => {
  const race = { id: 'r', slug: 'tour-x', name: 'Tour X', raceFormat: 'stages', websiteUrl: 'https://tour.example/', startlistImportedAt: '2026-01-01' };
  const rd = { id: 'd1', slug: 'tour-x-etapa-1', stageNumber: 1 };
  const guide = [{ type: 'technicalGuide', url: 'https://tour.example/guia.pdf' }];

  it('la barra marca las celdas laterales y la fila lateral las copia sin marca', () => {
    const { bar, side } = buildActionLinks({ race, rd, view: 'jornada', assets: guide, hasStartlist: true });
    expect(bar).toContain('data-side-link="website"');
    expect(bar).toContain('data-side-link="guide"');
    expect(bar).toContain('data-side-link="startlist"');
    expect(side).toContain('<nav class="race-side-links"');
    expect(side).not.toContain('data-side-link');
    expect(side).toContain('https://tour.example/guia.pdf');
    expect(bar).not.toContain('asset-links-wrap--side-only');
  });
  it('buildActionButtons devuelve solo la barra', () => {
    expect(buildActionButtons({ race, rd, view: 'jornada', hasStartlist: true })).toBe(buildActionLinks({ race, rd, view: 'jornada', hasStartlist: true }).bar);
  });
  it('la pestaña de Resultados activa usa la dirección recibida, sin leer location', () => {
    const { bar } = buildActionLinks({ race, rd, view: 'resultados', resultsUrl: '/resultados/tour-x/etapa-1/' });
    expect(bar).toContain('asset-btn--results" aria-current="page" href="/resultados/tour-x/etapa-1/"');
  });
  it('el marco pone cabecera y enlaces a un lado y migas y contenido en el principal', () => {
    const html = raceLayoutHtml({ headerHtml: '<div class="race-header"></div>', sideLinksHtml: '<nav class="race-side-links"></nav>', sideExtraHtml: '<nav class="stage-list"></nav>', crumbsHtml: '<nav class="race-crumbs"></nav>', mainHtml: '<p>x</p>' });
    expect(html).toBe('<div class="race-layout race-layout--facts"><aside class="race-layout__side"><div class="race-header"></div><nav class="race-side-links"></nav><nav class="stage-list"></nav></aside><div class="race-layout__main"><nav class="race-crumbs"></nav><p>x</p></div></div>');
    expect(raceLayoutHtml({ facts: false })).not.toContain('race-layout--facts');
  });
});

describe('teselas de totales de la general final', () => {
  it('suma las jornadas corridas (sin descansos ni canceladas) y omite las que no tienen dato', () => {
    const days = [
      { distanceKm: 100.5, elevationGain: 1000 },
      { distanceKm: 50, elevationGain: 500 },
      { distanceKm: 80, elevationGain: 900, isRestDay: true },
    ];
    const html = buildRaceTotalTiles(days);
    expect(html).toContain('150,5 km');
    expect(html).toContain('1.500 m');
    expect(html).toMatch(/stage-tile__label">Etapas<\/dt><dd class="stage-tile__value">2</);
    expect(html).not.toContain('km/h');
    expect(html).not.toContain('stage-tile--l');
    expect(buildRaceTotalTiles([])).toBe('');
  });
});
