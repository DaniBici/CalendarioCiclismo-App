import {cxUrl} from '../cx/editor-logic.js';

export function cxLogoSources(race,tournament=race?.cx_tournaments) {
  const sources=[];
  for(const [value,source] of [[race?.logoUrl,'race'],[tournament?.logoUrl,'tournament']]) {
    try {
      const url=cxUrl(value?.trim());
      if(url&&!sources.some(item=>item.url===url))sources.push({url,source});
    }catch{/* Una URL inválida no impide usar el logo del torneo. */}
  }
  return sources;
}

// Logo como HTML para las páginas que se generan en el build: el mismo orden de
// fuentes que cxLogoImage, con el cambio a la siguiente y la retirada final en
// onerror (el error puede llegar antes de que corra el JS de la página).
// `onUnavailable`: código que corre en onerror cuando no queda ninguna fuente,
// antes de retirar la imagen.
export function cxLogoHtml(race,tournament=race?.cx_tournaments,{className='race-logo-img',alt='',onUnavailable=''}={}) {
  const [first,...rest]=cxLogoSources(race,tournament).map(item=>item.url);
  if(!first)return '';
  const attr=value=>String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  const fallback=rest.length?` data-cx-logo-fallback="${attr(rest.join(' '))}"`:'';
  return `<img class="${attr(className)}" src="${attr(first)}" alt="${attr(alt)}" decoding="async"${fallback} onerror="var n=(this.dataset.cxLogoFallback||'').split(' ').filter(Boolean);if(n.length){this.dataset.cxLogoFallback=n.slice(1).join(' ');this.src=n[0]}else{${attr(onUnavailable)}${onUnavailable?';':''}this.remove()}">`;
}

export function cxLogoImage(race,tournament=race?.cx_tournaments,{className='race-logo-img',alt='',onState=()=>{}}={}) {
  const sources=cxLogoSources(race,tournament);
  if(!sources.length){onState({status:'empty'});return null;}
  const image=document.createElement('img');
  image.className=className;image.alt=alt;image.decoding='async';
  let index=0;
  const load=()=>{onState({...sources[index],status:'loading'});image.src=sources[index].url;};
  image.onload=()=>onState({...sources[index],status:'loaded'});
  image.onerror=()=>{
    if(++index<sources.length)load();
    else{image.onload=image.onerror=null;image.remove();onState({status:'unavailable'});}
  };
  load();return image;
}
