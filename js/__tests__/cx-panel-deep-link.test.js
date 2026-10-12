import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cxSeason, cxSeasonBounds } from '../cx/season.js';

// shared.js crea el cliente de Supabase con los globales de js/config.js y, vía i18n.js, lee window.location al cargarse.
vi.hoisted(() => Object.assign(globalThis, {
  SUPABASE_URL: '', SUPABASE_ANON_KEY: '', location: { hash: '', search: '', pathname: '/' },
  window: { location: { hostname: '', pathname: '/', search: '', hash: '' } },
}));
vi.mock('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm', () => ({ createClient: () => ({}) }));

const SECTIONS = ['identity', 'tv', 'videos', 'docs', 'results'];
const seasonKey = cxSeason(new Date());
const race = { id: 'cx-race', name: 'Carrera CX', slug: 'carrera-cx', seasonKey, dateKey: cxSeasonBounds(seasonKey).first,
  class: 'C2', editorialStatus: 'published', cx_race_categories: [] };

const node = () => ({ hidden: false, disabled: false, textContent: '', innerHTML: '', dataset: {}, style: {},
  classList: { add() {}, remove() {}, toggle() {} }, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; },
  addEventListener() {}, replaceChildren() {}, append() {}, prepend() {}, before() {}, querySelector: () => null, querySelectorAll: () => [] });

let openCxRaceEditor, panel;

// Monta el panel CX real con un cajón simulado y un cliente que devuelve la carrera pública.
beforeAll(async () => {
  const query = { select: () => query, eq: () => query, order: () => query, range: () => query, single: () => query,
    then: (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject) };
  const supabase = { from: table => (table === 'cx_races'
    ? { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: race, error: null }) }) }) } : query) };
  const tabs = SECTIONS.map(section => ({ ...node(), dataset: { section } }));
  const nodes = new Map();
  const body = { ...node(), querySelectorAll: selector => (selector === '[data-section]' ? tabs : []),
    querySelector: selector => nodes.get(selector) ?? nodes.set(selector, node()).get(selector) };
  const rail = { ...node(), children: [] };
  vi.stubGlobal('document', { querySelector: selector => (selector === '.panel-rail__scroll' ? rail : node()),
    querySelectorAll: () => [], createElement: node });
  ({ openCxRaceEditor } = await import('../panel/cx.js'));
  const { mountCxPanel } = await import('../panel/cx.js');
  panel = { navigate: vi.fn(), body, nodes, tabs, showToast: vi.fn(),
    openDrawer: vi.fn(({ render }) => { render(body); return { body, isCurrent: () => true, close() {} }; }) };
  mountCxPanel({ supabase, navigate: panel.navigate, openDrawer: panel.openDrawer, showToast: panel.showToast, countryFlag: () => '' });
});

beforeEach(() => { panel.navigate.mockClear(); panel.showToast.mockClear(); });

const selectedSection = () => panel.tabs.find(tab => tab.attributes['aria-selected'] === 'true')?.dataset.section;

describe('enlace público al editor CX', () => {
  it.each(['results', 'tv', 'docs'])('abre la carrera en la sección %s y cambia al área CX', async section => {
    await openCxRaceEditor('cx-race', section);
    expect(selectedSection()).toBe(section);
    expect(panel.navigate).toHaveBeenCalledWith('cxAgenda');
    expect(panel.showToast).not.toHaveBeenCalled();
  });

  it('abre General cuando el enlace no indica sección o indica una desconocida', async () => {
    await openCxRaceEditor('cx-race');
    expect(selectedSection()).toBe('identity');
    await openCxRaceEditor('cx-race', 'unknown');
    expect(selectedSection()).toBe('identity');
  });

  it('abre la preparación de dorsales sin marcar ninguna pestaña del editor', async () => {
    await openCxRaceEditor('cx-race', 'startlist');
    expect(selectedSection()).toBeUndefined();
    expect(panel.nodes.get('[data-save-section]').textContent).toBe('Preparar importación');
  });
});
