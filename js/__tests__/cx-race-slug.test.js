import {describe,it,expect} from 'vitest';
import {cxVenueCity,cxRaceSlugSuggestion,cxUniqueRaceSlug} from '../cx-editor-logic.js';

describe('slugs de pruebas CX',()=>{
  it('extrae la ciudad del recinto',()=>{
    expect(cxVenueCity('Marin, Pontevedra')).toBe('marin');
    expect(cxVenueCity('X Bionic center - Šamorín')).toBe('samorin');
    expect(cxVenueCity('Oro-Medonte, ON')).toBe('oro-medonte');
    expect(cxVenueCity('Glasgow Scotland')).toBe('glasgow-scotland');
    expect(cxVenueCity('')).toBe('');
    expect(cxVenueCity(null)).toBe('');
  });
  it('compone denominación y año civil sin torneo',()=>{
    expect(cxRaceSlugSuggestion({name:'Owocowy Przełaj',dateKey:'2026-11-14'})).toBe('owocowy-przelaj-2026');
    expect(cxRaceSlugSuggestion({name:'Internationale Sluitingsprijs - Oostmalle',dateKey:'2027-02-21'})).toBe('internationale-sluitingsprijs-oostmalle-2027');
    expect(cxRaceSlugSuggestion({name:'Boulder Cup',venue:'Boulder, Colorado',dateKey:'2026-11-15'})).toBe('boulder-cup-2026');
  });
  it('compone trofeo y ciudad con año civil',()=>{
    expect(cxRaceSlugSuggestion({name:'Koppenbergcross',tournamentName:'X2O Badkamers Trofee',venue:'Oudenaarde',dateKey:'2026-11-01'})).toBe('x2o-badkamers-trofee-oudenaarde-2026');
    expect(cxRaceSlugSuggestion({name:'GP Eric De Vlaeminck',tournamentName:'Telenet Superprestige',venue:'Heusden Zolder',dateKey:'2026-12-25'})).toBe('telenet-superprestige-heusden-zolder-2026');
    expect(cxRaceSlugSuggestion({name:'Coupe de France de Cyclo-Cross #5',tournamentName:'Coupe de France de Cyclo-cross',venue:'TBC',dateKey:'2026-12-12'})).toBe('coupe-de-france-de-cyclo-cross-tbc-2026');
  });
  it('mantiene versiones coherentes en castellano e inglés',()=>{
    const champs={name:'Campeonato de España',nameEn:'Spanish National Championships',dateKey:'2027-01-09'};
    expect(cxRaceSlugSuggestion(champs)).toBe('campeonato-de-espana-2027');
    expect(cxRaceSlugSuggestion({...champs,lang:'en'})).toBe('spanish-national-championships-2027');
    expect(cxRaceSlugSuggestion({name:'Campeonato de Australia',dateKey:'2026-08-14',lang:'en'})).toBe('campeonato-de-australia-2026');
    expect(cxRaceSlugSuggestion({name:'Kuilcross',tournamentName:'UCI Cyclocross World Cup',venue:'Zonhoven',dateKey:'2027-01-03',lang:'en'})).toBe('uci-cyclocross-world-cup-zonhoven-2027');
  });
  it('permite asignar Virginia del 27/9 a USCX sin duplicar el slug inglés del 26/9',()=>{
    const race={id:'day-2',name:"Virginia's Blue Ridge Go Cross",tournamentName:'Trek USCX',venue:'Roanoke, VA',dateKey:'2026-09-27',lang:'en'};
    const races=[{id:'day-1',slug:'virginia-s-blue-ridge-go-cross-day-1-2026',slugEn:'trek-uscx-roanoke-2026'},
      {id:'day-2',slug:'virginia-s-blue-ridge-go-cross-day-2-2026',slugEn:null}];
    const suggestion=cxRaceSlugSuggestion(race);
    expect(cxUniqueRaceSlug(suggestion,{races,raceId:race.id,dateKey:race.dateKey,lang:race.lang})).toBe('trek-uscx-roanoke-2026-09-27');
    expect(cxUniqueRaceSlug(suggestion,{races,raceId:'day-1',dateKey:'2026-09-26',lang:'en'})).toBe(suggestion);
    expect(cxUniqueRaceSlug(races[1].slug,{races,raceId:race.id,dateKey:race.dateKey})).toBe(races[1].slug);
  });
  it('resuelve colisiones adicionales sin superar el límite del slug',()=>{
    const suggestion='x'.repeat(80),dated='x'.repeat(74)+'-09-27';
    const races=[{id:'one',slug:suggestion},{id:'two',slug:dated}];
    const slug=cxUniqueRaceSlug(suggestion,{races,dateKey:'2026-09-27'});
    expect(slug).toHaveLength(80);expect(slug).toBe(dated.slice(0,78)+'-2');
    expect(cxUniqueRaceSlug('nuevo-2026',{races,dateKey:'2026-09-27'})).toBe('nuevo-2026');
  });
});
