import { describe, expect, it } from 'vitest';
import { parseUciTeamRoster } from '../results-fetchers/uci-team-roster.mjs';

const rider = id => ({ url: '/rider-details/' + id, givenName: 'María', familyName: 'PÉREZ', countryCode: 'ESP' });
const html = panels => '<div data-component="TeamDetailsModule" data-props="' +
  JSON.stringify({ riders: { panels } }).replaceAll('&', '&amp;').replaceAll('"', '&quot;') + '">';

describe('paneles oficiales UCI', () => {
  it('conserva Riders, Neo y Specialists, separa Trainees y excluye Management', () => {
    const result = parseUciTeamRoster(html([
      { label: 'Riders', riders: [rider(1)] }, { label: 'Neo', riders: [rider(2)] },
      { label: 'Trainees', riders: [rider(3)] }, { label: 'Management', riders: [rider(4)] },
      { label: 'Specialists', riders: [rider(5)] },
    ]));
    expect(result.regular.map(r => r.uciProfileId)).toEqual(['1', '2', '5']);
    expect(result.regular.map(r => r.sourcePanel)).toEqual(['Riders', 'Neo', 'Specialists']);
    expect(result.trainees).toEqual([{ ...rider(3), uciProfileId: '3', affiliationType: 'trainee', sourcePanel: 'Trainees', sourcePanels: ['Trainees'] }]);
  });
  it('no deduce una prueba del nombre del equipo ni de un enlace fuera del panel', () => {
    expect(parseUciTeamRoster(html([{ label: 'Riders', riders: [rider(1)] }]) +
      '<a href="/rider-details/2">Development Team</a>').trainees).toEqual([]);
  });
  it('detiene la ingesta si cambia el contrato', () => {
    expect(() => parseUciTeamRoster('<a href="/rider-details/1">Nombre</a>')).toThrow();
    expect(() => parseUciTeamRoster(html([{ label: 'Unknown', riders: [] }]))).toThrow();
  });
  it('conserva la procedencia cuando UCI repite un corredor en paneles regulares', () => {
    const result = parseUciTeamRoster(html([
      { label: 'Riders', riders: [rider(1)] }, { label: 'Neo', riders: [rider(1)] },
    ]));
    expect(result.regular).toHaveLength(1);
    expect(result.regular[0].sourcePanels).toEqual(['Riders', 'Neo']);
  });
  it('conserva por separado una contradicción regular/trainee para revisión', () => {
    const result = parseUciTeamRoster(html([
      { label: 'Riders', riders: [rider(1)] }, { label: 'Trainees', riders: [rider(1)] },
    ]));
    expect(result.regular.map(r => r.uciProfileId)).toEqual(['1']);
    expect(result.trainees.map(r => r.uciProfileId)).toEqual(['1']);
  });
  it('corrige el protocolo duplicado que publica UCI en algunas webs de equipo', () => {
    const props = { details: { website: { url: 'https://HTTP://WWW.EJEMPLO.COM' } }, riders: { panels: [] } };
    const source = '<div data-component="TeamDetailsModule" data-props="' +
      JSON.stringify(props).replaceAll('&', '&amp;').replaceAll('"', '&quot;') + '">';
    expect(parseUciTeamRoster(source).details.website.url).toBe('http://www.ejemplo.com/');
  });
});
