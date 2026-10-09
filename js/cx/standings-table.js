import {countryFlag,findMatchingTeam} from '../shared.js';
import {teamStripes} from '../team-appearance.js';
import {t} from '../i18n.js';
import {cxEsc as esc,cxRankSort,cxStandingValueCells,cxStandingsBreakdown} from './presentation.js';

// Tabla de una general CX, común a la ficha de carrera y a la página de torneo.
// El equipo va en su propia columna desde 601 px y como subtítulo del corredor
// por debajo. Con desglose por ronda (general por puntos calculada) la tabla se
// desplaza en horizontal si no cabe; `roundHeader(raceId,index)` devuelve
// {label,title,href} de cada columna.
export function cxStandingsTableHtml({rows,state,mode,lang='es',locale='es-ES',teamList=[],roundHeader=()=>null}) {
  const sorted=[...rows].sort(cxRankSort),values=cxStandingValueCells(sorted,mode,locale,lang);
  const breakdown=cxStandingsBreakdown(state,mode,locale);
  const hasTeam=sorted.some(row=>String(row.teamName||'').trim());
  const rounds=breakdown?breakdown.roundIds.map((id,index)=>({label:`#${index+1}`,...roundHeader(id,index)})):[];
  const roundTh=round=>{
    const label=esc(round.label),title=round.title?` title="${esc(round.title)}" aria-label="${esc(round.title)}"`:'';
    return `<th class="so-th cx-th--round">${round.href?`<a href="${esc(round.href)}"${title}>${label}</a>`:`<span${title}>${label}</span>`}</th>`;
  };
  const dropped=esc(t('cx.droppedResult'));
  const head=`<tr><th class="so-th res-th--rank">#</th><th class="so-th res-th--rider">${t('cx.rider')}</th>${hasTeam?`<th class="so-th res-th--team">${t('cx.team')}</th>`:''}<th class="so-th res-th--result">${esc(mode==='time'?t('cx.time'):t('cx.points'))}</th>${rounds.map(roundTh).join('')}</tr>`;
  const body=sorted.map(row=>{
    const team=findMatchingTeam(row.teamName,teamList),badge=team?teamStripes(team):'',value=values.get(row);
    const cells=breakdown?breakdown.cells(row).map(cell=>`<td class="so-td cx-td--round">${cell.dropped?`<s class="cx-round-dropped" title="${dropped}">${esc(cell.text)}</s>`:esc(cell.text)}</td>`).join(''):'';
    return `<tr class="so-row"><td class="so-td res-td--rank">${esc(row.rank)}</td><td class="so-td res-td--rider"><span class="so-flag">${countryFlag(row.isoCode2)}</span><span class="res-rider-main"><span class="res-rider-name">${esc(row.riderDisplay)}</span>${row.teamName?`<span class="res-rider-team">${badge}${esc(row.teamName)}</span>`:''}</span></td>${hasTeam?`<td class="so-td res-td--team">${row.teamName?`<span class="res-team-cell">${badge}${esc(row.teamName)}</span>`:''}</td>`:''}<td class="so-td res-td--result"><span class="${value.cls}">${esc(value.text)}</span></td>${cells}</tr>`;
  }).join('');
  const table=`<table class="so-table res-table cx-standings-table${breakdown?' cx-standings-table--rounds':''}"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  if(!breakdown)return `<div class="res-table-wrap">${table}</div>`;
  return `<div class="cx-standings-rounds" data-cx-standings-rounds><div class="res-table-wrap cx-standings-scroll" data-cx-standings-scroll>${table}</div><button type="button" class="cx-scroll-next" data-cx-scroll-next aria-label="${esc(t('cx.moreRounds'))}" hidden><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button></div>`;
}
// Indicador de desplazamiento: flecha y degradado en el borde derecho mientras
// quedan rondas fuera de la vista; la flecha avanza la tabla.
export function cxWireStandingsScroll(root) {
  for(const box of root.querySelectorAll('[data-cx-standings-rounds]:not([data-cx-wired])')) {
    box.dataset.cxWired='';
    // ResizeObserver vuelve a medir cuando una sección oculta pasa a mostrarse.
    const scroller=box.querySelector('[data-cx-standings-scroll]'),next=box.querySelector('[data-cx-scroll-next]');
    const table=scroller.querySelector('table');
    // El equipo solo ocupa columna mientras la tabla entera cabe sin desplazamiento:
    // se mide el ancho natural con la columna (rango, corredor, equipo, puntos y
    // 41,6 px por ronda) y, si supera el contenedor, el equipo pasa a subtítulo.
    // En un torneo de 8 rondas cabe desde 900 px; de 12 a 14, desde 1100 px.
    const fitTeam=()=>{
      box.classList.remove('cx-standings-compact');
      const min=table.style.minWidth;table.style.minWidth='0';
      const needed=table.offsetWidth;table.style.minWidth=min;
      box.classList.toggle('cx-standings-compact',needed>scroller.clientWidth);
    };
    const sync=()=>{
      if(scroller.clientWidth)fitTeam();
      const more=scroller.scrollLeft+scroller.clientWidth<scroller.scrollWidth-1;
      next.hidden=!more;box.classList.toggle('cx-standings-rounds--more',more);
    };
    next.addEventListener('click',()=>scroller.scrollBy({left:scroller.clientWidth*.6,behavior:'smooth'}));
    scroller.addEventListener('scroll',sync,{passive:true});
    if(typeof ResizeObserver!=='undefined')new ResizeObserver(sync).observe(scroller);
    sync();
  }
}
