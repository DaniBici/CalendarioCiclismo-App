import {describe,it,expect} from 'vitest';
import {cxHighlightSlide,cxTournamentHighlightSlide} from '../cx-highlight.js';

const highlight={targetType:'cxRace',cxRaceId:'cx'};
const race={id:'cx',seasonKey:'2026-27',dateKey:'2026-09-12',name:'Prueba CX',nameEn:'CX race',slug:'prueba-cx',slugEn:'cx-race',cx_tournaments:{colorHex:'#5a3210',logoUrl:'https://example.org/tournament.png'}};

describe('destinos CX del cintillo compartido',()=>{
  it('exige una carrera resuelta del destino y una fecha de temporada válida',()=>{
    expect(cxHighlightSlide(highlight,null)).toBeNull();
    expect(cxHighlightSlide({...highlight,cxRaceId:'otra'},race)).toBeNull();
    expect(cxHighlightSlide({...highlight,targetType:'race'},race)).toBeNull();
    expect(cxHighlightSlide(highlight,{...race,dateKey:'2027-03-01'})).toBeNull();
    expect(cxHighlightSlide(highlight,{...race,endDateKey:'2027-03-01'})).toBeNull();
  });
  it('resuelve ruta e identidad EN y fallback de torneo',()=>{
    expect(cxHighlightSlide(highlight,race,'en')).toMatchObject({href:'/en/cyclocross/cx-race/',name:'CX race',colorHex:'#5a3210',logoUrl:'https://example.org/tournament.png',date:'2026-09-12',detail:null});
  });
  it('conserva títulos/detalles custom traducidos escapados',()=>{
    expect(cxHighlightSlide({...highlight,customTitle:'Título',customTitleEn:'<Race>',customDetail:'Detalle',customDetailEn:'TV & live'},race,'en')).toMatchObject({name:'&lt;Race&gt;',detail:'TV &amp; live'});
  });
  it('prioriza logo custom seguro y descarta URLs no válidas',()=>{
    expect(cxHighlightSlide({...highlight,customLogo:'https://example.org/custom.png'},race).logoUrl).toBe('https://example.org/custom.png');
    expect(cxHighlightSlide({...highlight,customLogo:'javascript:alert(1)'},race).logoUrl).toBe('https://example.org/tournament.png');
  });
});

describe('destino de torneo del cintillo CX',()=>{
  const tournament={id:'t1',name:'Copa del Mundo',nameEn:'World Cup',slug:'world-cup',seasonKey:'2026-27',colorHex:'#8b173d',logoUrl:'https://example.org/series.png'};
  const target={targetType:'cxTournament',cxTournamentId:'t1'};

  it('exige la fila de torneo correspondiente',()=>{
    expect(cxTournamentHighlightSlide(target,null)).toBeNull();
    expect(cxTournamentHighlightSlide({...target,cxTournamentId:'otro'},tournament)).toBeNull();
    expect(cxTournamentHighlightSlide({...target,targetType:'cxRace'},tournament)).toBeNull();
  });

  it('resuelve la ruta de torneo ES/EN y usa la temporada como detalle',()=>{
    expect(cxTournamentHighlightSlide(target,tournament)).toMatchObject({href:'/ciclocross/torneos/world-cup/',name:'Copa del Mundo',detail:'2026-27',colorHex:'#8b173d',date:null});
    expect(cxTournamentHighlightSlide(target,tournament,'en')).toMatchObject({href:'/en/cyclocross/series/world-cup/',name:'World Cup'});
  });

  it('respeta título, detalle y logo custom',()=>{
    const custom={...target,customTitle:'Series',customTitleEn:'Series EN',customDetail:'Dos rondas',customLogo:'https://example.org/custom.png'};
    expect(cxTournamentHighlightSlide(custom,tournament,'en')).toMatchObject({name:'Series EN',detail:'Dos rondas',logoUrl:'https://example.org/custom.png'});
    expect(cxTournamentHighlightSlide({...target,customLogo:'javascript:alert(1)'},tournament).logoUrl).toBe('https://example.org/series.png');
  });
});
