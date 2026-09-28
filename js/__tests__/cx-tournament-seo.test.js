import {describe,it,expect} from 'vitest';
import {cxTournamentDescription} from '../cx/tournament-seo.js';

const tournament={id:'t',name:'Copa del Mundo UCI',seasonKey:'2026-27'};
const first={id:'first',tournamentId:'t',dateKey:'2026-11-27'};
const last={id:'last',tournamentId:'t',dateKey:'2027-01-24'};
const ending='Consulta fechas, horarios, resultados y cómo ver por TV y online streaming.';

describe('descripción SEO de torneos CX',()=>{
  it('usa la fórmula solicitada, las pruebas únicas y las fechas sin año',()=>{
    const rows=[last,first,first,{...first,id:'other',tournamentId:'other'},
      {...first,id:'old',dateKey:'2025-11-27'},{...last,id:'outside',dateKey:'2027-03-01'}];
    expect(cxTournamentDescription(tournament,rows)).toBe(
      `La Copa del Mundo UCI abarca 2 pruebas del 27 de noviembre al 24 de enero. ${ending}`);
  });
  it.each([
    ['Superprestige','El Superprestige'],['X2O Badkamers Trofee','El X2O Badkamers Trofee'],
    ['Copa de España','La Copa de España'],['Coupe de France','La Coupe de France'],
    ['Swiss Cyclocross Cup','La Swiss Cyclocross Cup'],['Taça de Portugal','La Taça de Portugal'],
    ['National Trophy','El National Trophy'],['La Copa local','La Copa local'],
  ])('elige el artículo sin duplicarlo para %s',(name,subject)=>{
    expect(cxTournamentDescription({...tournament,name},[first,last])).toBe(
      `${subject} abarca 2 pruebas del 27 de noviembre al 24 de enero. ${ending}`);
  });
  it('cuenta una carrera multidía una vez y conserva su fecha final oficial',()=>{
    const race={...first,endDateKey:'2026-11-29',cx_race_categories:[
      {category:'WE',dateKey:'2026-11-28'},{category:'ME',dateKey:'2026-11-29'}]};
    expect(cxTournamentDescription(tournament,[race])).toBe(
      `La Copa del Mundo UCI abarca 1 prueba del 27 de noviembre al 29 de noviembre. ${ending}`);
  });
  it('usa el enlace de torneo del generador y no inventa fechas en un torneo vacío',()=>{
    const {tournamentId,...race}=first;
    expect(cxTournamentDescription(tournament,[{...race,cx_tournaments:tournament}])).toContain('abarca 1 prueba');
    expect(cxTournamentDescription(tournament,[])).toBe(`La Copa del Mundo UCI abarca 0 pruebas. ${ending}`);
  });
});
