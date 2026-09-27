import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { startlistRosterCandidates } from '../results-panel-logic.js';

const source = readFileSync(new URL('../panel.js', import.meta.url), 'utf8');
const matchingSource = source.slice(
  source.indexOf('function _slApplyAutomaticRiderMatch('),
  source.indexOf('function _slAutoDorsalForRider('),
);
const eventsStart = source.indexOf('// Flujo rápido de carga por bloques de equipo.');
const eventsSource = source.slice(eventsStart, source.indexOf("  content.addEventListener('input',", eventsStart));
const roster = [
  { id: 'kim-le-court', firstName: 'Kim', lastName: 'Le Court', nationality: 'mu' },
  { id: 'julie-martin', firstName: 'Julie', lastName: 'Martin', nationality: 'fr' },
  { id: 'julie-le-roux', firstName: 'Julie', lastName: 'Le Roux', nationality: 'fr' },
];

function element() {
  return { style: {}, dataset: {}, children: [],
    appendChild(child) { this.children.push(child); },
    replaceChildren() { this.children = []; },
    addEventListener: vi.fn(),
  };
}

function editor({ firstName = '', lastName = '', loadRoster = async () => roster } = {}) {
  const listeners = {};
  const team = { dataset: { teamId: 'team' } };
  const fields = {
    '.sl-firstname': { value: firstName },
    '.sl-lastname': { value: lastName },
    '.sl-country': { value: '' },
    '.sl-flag-preview': element(),
    '.sl-rider-matched': element(),
    '.sl-rider-suggestion': element(),
  };
  const row = { dataset: {}, closest: () => team, querySelector: selector => fields[selector] };
  for (const [selector, field] of Object.entries(fields)) {
    field.matches = selectors => selectors.split(',').some(value => value.trim() === selector);
    field.closest = selector => selector === '.sl-edit-rider' ? row : team;
  }
  const context = vm.createContext({
    content: { addEventListener: (type, handler) => { listeners[type] = handler; } },
    document: { contains: candidate => candidate === row, createElement: element },
    _editingRaceId: 'race', _slAutoMatchSequence: 0,
    _slLoadTeamRosterForMatch: vi.fn(loadRoster), startlistRosterCandidates,
    _slRefreshRiderMatchBtn: vi.fn(), _slRiderFlagPreview: code => code,
    _slAutoDorsalForRider: vi.fn(), _slFocusFirstSurname: vi.fn(() => true),
    _slFocusAdjacentSurname: vi.fn(() => true), console,
  });
  vm.runInContext(matchingSource + '\n' + eventsSource, context);
  return { context, fields, row,
    dispatch(type, selector, options = {}) {
      const event = { target: fields[selector], key: 'Tab', shiftKey: false, preventDefault: vi.fn(), ...options };
      listeners[type](event);
      return event;
    },
  };
}

describe('automatcheo por Tab en el editor de inscritos', () => {
  it.each([
    ['.sl-firstname', false], ['.sl-firstname', true],
    ['.sl-lastname', false], ['.sl-lastname', true],
  ])('busca desde %s con Shift=%s sin depender de focusout', async (selector, shiftKey) => {
    const ui = editor(selector === '.sl-firstname' ? { firstName: 'KIM' } : { lastName: 'le court' });
    const event = ui.dispatch('keydown', selector, { shiftKey });
    expect(ui.context._slLoadTeamRosterForMatch).toHaveBeenCalledWith('team');
    await vi.waitFor(() => expect(ui.row.dataset.globalRiderId).toBe('kim-le-court'));
    expect(ui.fields['.sl-firstname'].value).toBe('Kim');
    expect(ui.fields['.sl-lastname'].value).toBe('Le Court');
    expect(ui.fields['.sl-country'].value).toBe('mu');
    if (selector === '.sl-lastname') {
      expect(ui.context._slFocusAdjacentSurname).toHaveBeenCalledWith(ui.row, shiftKey);
      expect(event.preventDefault).toHaveBeenCalledOnce();
    } else {
      expect(ui.context._slFocusAdjacentSurname).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
  });

  it.each(['.sl-firstname', '.sl-lastname'])('mantiene el matching al salir de %s sin Tab', async selector => {
    const ui = editor({ firstName: 'Kim' });
    ui.dispatch('focusout', selector);
    await vi.waitFor(() => expect(ui.row.dataset.globalRiderId).toBe('kim-le-court'));
  });

  it('muestra las coincidencias de un nombre ambiguo sin enlazarlo', async () => {
    const ui = editor({ firstName: 'Julie' });
    ui.dispatch('keydown', '.sl-firstname');
    await vi.waitFor(() => expect(ui.fields['.sl-rider-suggestion'].style.display).toBe('block'));
    expect(ui.row.dataset.globalRiderId).toBeUndefined();
    expect(ui.fields['.sl-rider-suggestion'].children.slice(1).map(button => button.textContent))
      .toEqual(['Julie Martin', 'Julie Le Roux']);
  });

  it('respeta ambos campos y no enlaza un nombre contradictorio', async () => {
    const ui = editor({ firstName: 'Julie', lastName: 'Le Court' });
    ui.dispatch('keydown', '.sl-firstname');
    await vi.waitFor(() => expect(ui.fields['.sl-rider-suggestion'].style.display).toBe('none'));
    expect(ui.row.dataset.globalRiderId).toBeUndefined();
  });

  it('aplica una sola vez si Tab va seguido de focusout', async () => {
    const ui = editor({ firstName: 'Kim' });
    ui.dispatch('keydown', '.sl-firstname');
    ui.dispatch('focusout', '.sl-firstname');
    await vi.waitFor(() => expect(ui.row.dataset.globalRiderId).toBe('kim-le-court'));
    expect(ui.context._slRefreshRiderMatchBtn).toHaveBeenCalledOnce();
  });

  it('descarta la respuesta si se edita el nombre mientras busca', async () => {
    let resolveRoster;
    const ui = editor({ firstName: 'Kim', loadRoster: () => new Promise(resolve => { resolveRoster = resolve; }) });
    ui.dispatch('keydown', '.sl-firstname');
    expect(ui.context._slLoadTeamRosterForMatch).toHaveBeenCalledOnce();
    ui.fields['.sl-firstname'].value = 'Julie';
    resolveRoster(roster);
    await Promise.resolve();
    expect(ui.row.dataset.globalRiderId).toBeUndefined();
    expect(ui.fields['.sl-firstname'].value).toBe('Julie');
    expect(ui.context._slRefreshRiderMatchBtn).not.toHaveBeenCalled();
  });

  it('no busca al pulsar otras teclas', () => {
    const ui = editor({ firstName: 'Kim' });
    ui.dispatch('keydown', '.sl-firstname', { key: 'ArrowRight' });
    expect(ui.context._slLoadTeamRosterForMatch).not.toHaveBeenCalled();
  });
});
