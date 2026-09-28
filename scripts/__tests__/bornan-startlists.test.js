import { describe, expect, it } from 'vitest';
import {
  collectEntries,
  parseStartListText,
  properCase,
  uciProfileFromIfId,
} from '../results-fetchers/bornan-startlist-fetch.mjs';
import {
  buildDocument,
  sourceSignature,
  storedSignature,
} from '../results-fetchers/bornan-startlists-sync.mjs';

const startList = `
                                                    Ciclismo Ruta
                                                       Ruta Masculino
                                                    Men's Road Race
                             WED 23 SEP 2026
                                                                               Start List
                                                                          As of WED 23 SEP 2026 at 13:05
        Start                                                                   NOC
                    Bib Name                                                               Date of Birth
        Time                                                                    Code
     11:01:00           6 KALEJMAN Mateo                                        ARG        14 SEP 2004
     11:02:00        43 DOMINGUEZ Carlos                                        PAR        25 MAR 2004
   CRDMRR----------------FNL-000100--_51R_1_0                       Report Created WED 23 SEP 2026 13:05    Page 1/1
`;

describe('Bornan — inscritos de los Juegos', () => {
  it('deriva el uciProfileId del UCI ID de 11 dígitos', () => {
    expect(uciProfileFromIfId('100 952 285 20')).toBe('952285');
    expect(uciProfileFromIfId('10146125834')).toBe('1461258');
    expect(uciProfileFromIfId('10010799013')).toBe('107990');
    expect(uciProfileFromIfId('123')).toBeNull();
    expect(uciProfileFromIfId('')).toBeNull();
  });

  it('normaliza a forma de catálogo los apellidos en mayúsculas', () => {
    expect(properCase('AL HAYAT')).toBe('Al Hayat');
    expect(properCase('AL-MARRI')).toBe('Al-Marri');
    expect(properCase('QUANG')).toBe('Quang');
    expect(properCase('')).toBe('');
  });

  it('lee la lista de salida oficial con dorsales y horas', () => {
    const { riders, dateKey } = parseStartListText(startList, {
      expectedDate: '2026-09-23',
      expectedEventToken: 'CRDMRR----------------FNL-000100--',
    });
    expect(dateKey).toBe('2026-09-23');
    expect(riders).toHaveLength(2);
    expect(riders[0]).toMatchObject({ bib: 6, firstName: 'Mateo', lastName: 'Kalejman', nation: 'ARG', birthDate: '2004-09-14', startTime: '11:01:00' });
    expect(riders[1]).toMatchObject({ bib: 43, lastName: 'Dominguez', startTime: '11:02:00' });
  });

  it('rechaza la fecha y la unidad equivocadas', () => {
    expect(() => parseStartListText(startList, { expectedDate: '2026-09-24' })).toThrow('no de 2026-09-24');
    expect(() => parseStartListText(startList, { expectedEventToken: 'CRDWTT----------------FNL-000100--' })).toThrow('unidad esperada');
  });

  it('recoge los participantes de un evento desde las entradas por NOC', () => {
    const list = { orgs: [{ Key: 'JPN', Desc: 'Japan' }, { Key: 'CHN', Desc: 'China' }] };
    const orgPayloads = new Map([
      ['JPN', { Events: [
        { EvKey: 'M.RR----------------', Partics: [{ Reg: '1', Name: 'TODOME Yuhi', GivenName: 'Yuhi', FamilyName: 'TODOME', BirthDateRaw: '2002-06-18', IFId: '100 952 285 20' }] },
        { EvKey: 'M.TT----------------', Partics: [{ Reg: '1', Name: 'TODOME Yuhi', GivenName: 'Yuhi', FamilyName: 'TODOME', BirthDateRaw: '2002-06-18', IFId: '100 952 285 20' }] },
      ] }],
      ['CHN', { Events: [{ EvKey: 'M.RR----------------', Partics: [{ Reg: '2', Name: 'ZHANG Wei', GivenName: 'Wei', FamilyName: 'ZHANG', BirthDateRaw: '2001-01-01', IFId: '' }] }] }],
    ]);
    const riders = collectEntries({ list, orgPayloads, eventKey: 'M.RR----------------' });
    expect(riders).toHaveLength(2);
    expect(riders[0]).toMatchObject({ reg: '1', firstName: 'Yuhi', lastName: 'Todome', nation: 'JPN', uciProfileId: '952285' });
    expect(riders[1]).toMatchObject({ reg: '2', lastName: 'Zhang', uciProfileId: null });
  });

  it('agrupa por selección y firma la lista sin depender de los nombres canónicos', () => {
    const riders = [
      { reg: '10', bib: null, firstName: 'Yuhi', lastName: 'TODOME', nation: 'JPN', birthDate: '2002-06-18' },
      { reg: '11', bib: null, firstName: 'Yuma', lastName: 'KOISHI', nation: 'JPN', birthDate: '1993-09-15' },
    ];
    const teamByKey = new Map([['jp|male', { id: 'team_ntm_japan', name: 'Japan' }]]);
    const document = buildDocument({ raceId: 'r1', gender: 'male', riders, sourceUrl: 'u', teamByKey, globalByKey: new Map([['10', 'todome-yuhi']]) });
    expect(document.expectedRiderCount).toBe(2);
    expect(document.teams).toHaveLength(1);
    expect(document.teams[0]).toMatchObject({ teamName: 'Japan', teamId: 'team_ntm_japan' });
    expect(document.teams[0].riders[0]).toMatchObject({ rowKey: '10', dorsal: 0, countryCode: 'jp', globalRiderId: 'todome-yuhi' });
    expect(document.teams[0].riders[1]).toMatchObject({ rowKey: '11', dorsal: 0, countryCode: 'jp' });

    const desired = sourceSignature(riders, new Map([['10', 'todome-yuhi'], ['11', 'koishi-yuma']]));
    const stored = storedSignature({ 10: { dorsal: 0, countryCode: 'jp', globalRiderId: 'todome-yuhi' }, 11: { dorsal: 0, countryCode: 'jp', globalRiderId: 'koishi-yuma' } });
    expect(desired).toBe(stored);
    expect(storedSignature({ 10: { dorsal: 0, countryCode: 'jp', globalRiderId: 'todome-yuhi' } })).not.toBe(desired);
  });
});
