import {cxUrl} from '../cx-editor-logic.js';

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
