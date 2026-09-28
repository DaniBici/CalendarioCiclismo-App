import {cxDateInSeason} from './season.js';
import {cxEsc,cxColor,cxRaceName,cxRaceUrl,cxTournamentUrl,cxTournamentColor} from './presentation.js';
import {cxLogoSources} from '../components/cx-logo.js';

export function cxHighlightSlide(highlight,race,lang='es') {
  if(highlight.targetType!=='cxRace'||!race||race.id!==highlight.cxRaceId||!cxDateInSeason(race.seasonKey,race.dateKey)||(race.endDateKey&&!cxDateInSeason(race.seasonKey,race.endDateKey)))return null;
  const title=lang==='en'?(highlight.customTitleEn||highlight.customTitle):(highlight.customTitle);
  const detail=lang==='en'?(highlight.customDetailEn||highlight.customDetail):highlight.customDetail;
  return {href:cxRaceUrl(race,lang),logoUrl:cxLogoSources({...race,logoUrl:highlight.customLogo||race.logoUrl})[0]?.url||null,
    name:cxEsc(title||cxRaceName(race,lang)),detail:detail?cxEsc(detail):null,colorHex:cxColor(race),date:race.dateKey};
}

// Destino «torneo»: la página de serie (/ciclocross/torneos/<slug>/ o
// /en/cyclocross/series/<slug>/). El torneo no tiene fecha propia; el detalle
// por defecto es su temporada.
export function cxTournamentHighlightSlide(highlight,tournament,lang='es') {
  if(highlight.targetType!=='cxTournament'||!tournament||tournament.id!==highlight.cxTournamentId)return null;
  const title=lang==='en'?(highlight.customTitleEn||highlight.customTitle):(highlight.customTitle);
  const detail=lang==='en'?(highlight.customDetailEn||highlight.customDetail):highlight.customDetail;
  return {href:cxTournamentUrl(tournament,lang),logoUrl:cxLogoSources({logoUrl:highlight.customLogo},{logoUrl:tournament.logoUrl})[0]?.url||null,
    name:cxEsc(title||cxRaceName(tournament,lang)),detail:detail?cxEsc(detail):(tournament.seasonKey?cxEsc(tournament.seasonKey):null),
    colorHex:cxTournamentColor(tournament)||(/^#[0-9a-f]{6}$/i.test(tournament.colorHex||'')?tournament.colorHex:null),date:null};
}
